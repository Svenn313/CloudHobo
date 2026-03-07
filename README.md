# 🏠 Homelab

Personal self-hosted infrastructure running on Docker.
This repo contains all the configuration files to spin up my services.

## Stack

| Service | Description |
|---|---|
| **Matrix / Synapse** | Self-hosted Matrix homeserver |
| **mautrix-whatsapp** | WhatsApp bridge for Matrix |
| **mautrix-signal** | Signal bridge for Matrix |
| **mautrix-telegram** | Telegram bridge for Matrix |
| **Synapse Admin** | Admin UI for Synapse |
| **Joplin** | Self-hosted note syncing server |
| **Mealie** | Recipe manager & meal planner |
| **Heimdall** | Dashboard for all services |
| **Home Assistant** | Home automation |
| **Pihole** | Network-wide ad blocker / DNS |
| **PostgreSQL** | Database backend |
| **Postfix** | SMTP Server |

## Usage

```bash
# Start everything
docker compose up -d

# Stop everything
docker compose down

# View logs
docker logs -f <container>
```

## Requirements

- Docker & Docker Compose
- A domain with DNS properly configured
- A reverse proxy

## MISC

There is some other container in the docker-compose that are currently inactive
(mostly because I dont use/need them anymore)
