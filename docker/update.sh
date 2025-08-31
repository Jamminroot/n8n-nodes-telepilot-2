#!/bin/bash
set -e

echo "=== n8n and TelePilot2 Update Script ==="
echo ""

# Parse arguments
UPDATE_N8N=false
UPDATE_TELEPILOT=false
N8N_VERSION="latest"
TELEPILOT_VERSION="latest"

while [[ $# -gt 0 ]]; do
    case $1 in
        --n8n)
            UPDATE_N8N=true
            if [[ -n $2 && ! $2 == --* ]]; then
                N8N_VERSION="$2"
                shift
            fi
            ;;
        --telepilot)
            UPDATE_TELEPILOT=true
            if [[ -n $2 && ! $2 == --* ]]; then
                TELEPILOT_VERSION="$2"
                shift
            fi
            ;;
        --all)
            UPDATE_N8N=true
            UPDATE_TELEPILOT=true
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --n8n [version]       Update n8n (optionally specify version)"
            echo "  --telepilot [version] Update TelePilot2 (optionally specify version)"
            echo "  --all                 Update both n8n and TelePilot2"
            echo "  --help                Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --all                    # Update both to latest"
            echo "  $0 --n8n 1.20.0             # Update n8n to specific version"
            echo "  $0 --telepilot              # Update TelePilot2 to latest"
            echo "  $0 --telepilot 0.7.2        # Update TelePilot2 to specific version"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
    shift
done

# If no options specified, show current versions
if [ "$UPDATE_N8N" = false ] && [ "$UPDATE_TELEPILOT" = false ]; then
    echo "Current versions:"
    docker exec n8n-n8n-1 npx n8n --version 2>/dev/null && echo "n8n: $(docker exec n8n-n8n-1 npx n8n --version 2>/dev/null)" || echo "n8n: not running"
    docker exec n8n-n8n-1 sh -c "cd ~/.n8n/nodes && npm list n8n-nodes-telepilot-2 2>/dev/null | grep n8n-nodes-telepilot-2" || echo "TelePilot2: not installed"
    echo ""
    echo "Use --help to see update options"
    exit 0
fi

# Update n8n
if [ "$UPDATE_N8N" = true ]; then
    echo "Updating n8n to version: $N8N_VERSION"
    if [ "$N8N_VERSION" = "latest" ]; then
        docker exec n8n-n8n-1 npm install -g n8n@latest
    else
        docker exec n8n-n8n-1 npm install -g n8n@$N8N_VERSION
    fi
    echo "n8n updated successfully"
fi

# Update TelePilot2
if [ "$UPDATE_TELEPILOT" = true ]; then
    echo "Updating TelePilot2 to version: $TELEPILOT_VERSION"
    docker exec n8n-n8n-1 sh -c "cd ~/.n8n/nodes && npm uninstall n8n-nodes-telepilot-2"
    if [ "$TELEPILOT_VERSION" = "latest" ]; then
        docker exec n8n-n8n-1 sh -c "cd ~/.n8n/nodes && npm install n8n-nodes-telepilot-2"
    else
        docker exec n8n-n8n-1 sh -c "cd ~/.n8n/nodes && npm install n8n-nodes-telepilot-2@$TELEPILOT_VERSION"
    fi
    
    # Rebuild native modules
    docker exec n8n-n8n-1 sh -c "cd ~/.n8n/nodes/node_modules/tdl && npm rebuild" 2>/dev/null || true
    echo "TelePilot2 updated successfully"
fi

# Restart n8n
echo "Restarting n8n..."
docker-compose restart n8n

echo ""
echo "=== Update complete ==="
echo "New versions:"
docker exec n8n-n8n-1 npx n8n --version 2>/dev/null && echo "n8n: $(docker exec n8n-n8n-1 npx n8n --version 2>/dev/null)" || echo "n8n: restarting..."
docker exec n8n-n8n-1 sh -c "cd ~/.n8n/nodes && npm list n8n-nodes-telepilot-2 2>/dev/null | grep n8n-nodes-telepilot-2" || echo "TelePilot2: restarting..."