import { Container } from 'typedi';

import {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';

const debug = require('debug')('telepilot-album-trigger');

import {
	TelePilotNodeConnectionManager,
	TelepilotAuthState,
} from './TelePilotNodeConnectionManager';
import { TDLibUpdate } from './tdlib/types';
import { Client } from 'tdl';

interface BufferedAlbum {
	messages: IDataObject[];
	timer: ReturnType<typeof setTimeout>;
	chatId: number;
	firstDate: number;
}

export class TelePilotAlbumTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TelePilot2 Album Trigger',
		name: 'telePilotAlbumTrigger',
		icon: 'file:TelePilot.svg',
		group: ['trigger'],
		version: 1,
		description: 'Triggers when a new album (group of media messages) is received',
		defaults: {
			name: 'TelePilot2 Album Trigger',
		},
		inputs: [],
		outputs: ['main'] as any,
		credentials: [
			{
				name: 'telePilotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Chat ID Filter',
				description:
					'Only trigger for albums in this chat. Leave empty (0) to trigger for all chats.',
				name: 'chatIdFilter',
				type: 'number',
				default: 0,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Album Collect Window (Seconds)',
						description:
							'How many seconds to wait for additional messages belonging to the same album before emitting. Telegram typically sends all album messages within 1-2 seconds.',
						name: 'collectWindowSeconds',
						type: 'number',
						default: 3,
						typeOptions: {
							minValue: 1,
							maxValue: 30,
						},
					},
					{
						displayName: 'Include Standalone Messages',
						description:
							'Whether to also emit messages that are not part of an album (single photos, videos, text, etc.)',
						name: 'includeStandalone',
						type: 'boolean',
						default: false,
					},
					{
						displayName: 'Ignore Groups',
						description: 'Whether to ignore albums from group chats (negative chat IDs)',
						name: 'ignoreGroups',
						type: 'boolean',
						default: false,
					},
				],
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = await this.getCredentials('telePilotApi');

		const cM = Container.get(TelePilotNodeConnectionManager);

		let client: Client;
		const clientSession = await cM.createClientSetAuthHandlerForPhoneNumberLogin(
			credentials?.apiId as number,
			credentials?.apiHash as string,
			credentials?.phoneNumber as string,
		);
		debug('albumTrigger.clientSession.authState: ' + clientSession.authState);
		if (clientSession.authState != TelepilotAuthState.WAIT_READY) {
			await cM.closeLocalSession(credentials?.apiId as number);
			this.emit([
				this.helpers.returnJsonArray([
					{
						error:
							'Telegram account not logged in. ' +
							'Please use ChatTrigger node together with loginWithPhoneNumber action. ' +
							'Please check our guide at https://telepilot.co/login-howto',
					},
				]),
			]);
			return { closeFunction: async () => {} };
		}

		client = clientSession.client;

		const chatIdFilter = this.getNodeParameter('chatIdFilter', 0) as number;
		const options = this.getNodeParameter('options', {}) as {
			collectWindowSeconds?: number;
			includeStandalone?: boolean;
			ignoreGroups?: boolean;
		};

		const collectWindowMs = (options.collectWindowSeconds ?? 3) * 1000;
		const includeStandalone = options.includeStandalone ?? false;
		const ignoreGroups = options.ignoreGroups ?? false;

		const pendingAlbums: Map<string, BufferedAlbum> = new Map();

		const emitAlbum = (albumId: string, album: BufferedAlbum) => {
			album.messages.sort((a, b) => {
				const idA = BigInt((a.id as number) || 0);
				const idB = BigInt((b.id as number) || 0);
				if (idA < idB) return -1;
				if (idA > idB) return 1;
				return 0;
			});

			let caption = '';
			for (const msg of album.messages) {
				const content = msg.content as IDataObject | undefined;
				if (content) {
					const captionObj = content.caption as IDataObject | undefined;
					const textObj = content.text as IDataObject | undefined;
					if (captionObj?.text) {
						caption = captionObj.text as string;
						break;
					} else if (textObj?.text) {
						caption = textObj.text as string;
						break;
					}
				}
			}

			const payload: IDataObject = {
				album_id: albumId,
				chat_id: album.chatId,
				message_count: album.messages.length,
				first_message_id: album.messages[0].id,
				last_message_id: album.messages[album.messages.length - 1].id,
				date: album.firstDate,
				caption,
				messages: album.messages,
			};

			debug('Emitting album ' + albumId + ' with ' + album.messages.length + ' messages');
			this.emit([this.helpers.returnJsonArray([payload])]);
			pendingAlbums.delete(albumId);
		};

		const processUpdate = (update: IDataObject | TDLibUpdate) => {
			if (update._ !== 'updateNewMessage') return;

			const message = update.message as IDataObject | undefined;
			if (!message) return;

			const chatId = message.chat_id as number;

			if (ignoreGroups && typeof chatId === 'number' && chatId < 0) {
				return;
			}

			if (chatIdFilter !== 0 && chatId !== chatIdFilter) {
				return;
			}

			const albumId = message.media_album_id;
			const albumIdStr = String(albumId);
			const isAlbumMessage =
				albumId !== undefined && albumId !== null && albumIdStr !== '0' && albumIdStr !== '';

			if (!isAlbumMessage) {
				if (includeStandalone) {
					let caption = '';
					const content = message.content as IDataObject | undefined;
					if (content) {
						const captionObj = content.caption as IDataObject | undefined;
						const textObj = content.text as IDataObject | undefined;
						if (captionObj?.text) {
							caption = captionObj.text as string;
						} else if (textObj?.text) {
							caption = textObj.text as string;
						}
					}

					const payload: IDataObject = {
						album_id: '0',
						chat_id: chatId,
						message_count: 1,
						first_message_id: message.id,
						last_message_id: message.id,
						date: message.date,
						caption,
						messages: [message],
					};

					debug('Emitting standalone message ' + message.id);
					this.emit([this.helpers.returnJsonArray([payload])]);
				}
				return;
			}

			const existing = pendingAlbums.get(albumIdStr);
			if (existing) {
				clearTimeout(existing.timer);
				existing.messages.push(message);
				existing.timer = setTimeout(() => emitAlbum(albumIdStr, existing), collectWindowMs);
			} else {
				const newAlbum: BufferedAlbum = {
					messages: [message],
					chatId,
					firstDate: message.date as number,
					timer: setTimeout(() => {
						emitAlbum(albumIdStr, newAlbum);
					}, collectWindowMs),
				};
				pendingAlbums.set(albumIdStr, newAlbum);
			}
		};

		if (this.getMode() !== 'manual') {
			client.on('update', processUpdate);
			client.on('error', debug);
		}

		async function closeFunction() {
			debug('closeFunction()');
			client.removeListener('update', processUpdate);
			for (const [, album] of pendingAlbums) {
				clearTimeout(album.timer);
			}
			pendingAlbums.clear();
		}

		const manualTriggerFunction = async () => {
			await new Promise<void>((resolve, reject) => {
				const timeoutHandler = setTimeout(() => {
					client.removeListener('update', manualListener);
					for (const [, album] of pendingAlbums) {
						clearTimeout(album.timer);
					}
					pendingAlbums.clear();
					reject(
						new Error(
							'Aborted, no album received within 60secs. ' +
								'This 60sec timeout is only set for "manually triggered execution". ' +
								'Active Workflows will listen indefinitely.',
						),
					);
				}, 60000);

				const originalEmit = this.emit.bind(this);
				const self = this;
				self.emit = ((data: any) => {
					originalEmit(data);
					clearTimeout(timeoutHandler);
					client.removeListener('update', manualListener);
					resolve();
				}) as any;

				const manualListener = (update: IDataObject | TDLibUpdate) => {
					processUpdate(update);
				};

				client.on('update', manualListener);
			});
		};

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}
