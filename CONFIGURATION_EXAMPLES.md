# Configuração de Ambiente - Fix Connection Closed 428

## Variáveis de Ambiente Recomendadas

```bash
# WhatsApp Web Version (CRÍTICO para estabilidade)
CONFIG_SESSION_PHONE_VERSION=2.3000.1015901002

# Session Configuration
CONFIG_SESSION_PHONE_CLIENT="Evolution API"
CONFIG_SESSION_PHONE_NAME="Chrome"

# Logging (para monitoramento do fix)
LOG_LEVEL=INFO,BAILEYS,ERROR

# Connection Settings (opcionais - já configurados no código)
# QRCODE_LIMIT=30
# DEL_INSTANCE=3600  # segundos para deletar instância inativa

# Database (recomendado manter habilitado)
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true

# Cache (recomendado para performance)
CACHE_REDIS_ENABLED=true
CACHE_REDIS_SAVE_INSTANCES=true
```

## Docker Compose - Exemplo Completo

```yaml
version: '3.8'

services:
  evolution-api:
    image: atendai/evolution-api:latest
    restart: unless-stopped
    environment:
      # Fix Connection Closed 428
      - CONFIG_SESSION_PHONE_VERSION=2.3000.1015901002
      - CONFIG_SESSION_PHONE_CLIENT=Evolution API
      - CONFIG_SESSION_PHONE_NAME=Chrome
      
      # Logging para monitoramento
      - LOG_LEVEL=INFO,BAILEYS,ERROR
      
      # Database
      - DATABASE_ENABLED=true
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_CONNECTION_URI=postgresql://user:pass@postgres:5432/evolution
      - DATABASE_CONNECTION_CLIENT_NAME=evolution_api_server_1
      
      # Redis Cache
      - CACHE_REDIS_ENABLED=true
      - CACHE_REDIS_URI=redis://redis:6379
      - CACHE_REDIS_SAVE_INSTANCES=true
      
      # Server
      - SERVER_PORT=8080
      - SERVER_URL=http://localhost:8080
      
      # Auth
      - AUTHENTICATION_API_KEY_KEY=your-api-key-here
      
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis
    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store

  postgres:
    image: postgres:15
    restart: unless-stopped
    environment:
      - POSTGRES_DB=evolution
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  evolution_instances:
  evolution_store:
  postgres_data:
  redis_data:
```

## PM2 Ecosystem - Exemplo

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'evolution-api',
    script: './dist/src/main.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      
      // Fix Connection Closed 428
      CONFIG_SESSION_PHONE_VERSION: '2.3000.1015901002',
      CONFIG_SESSION_PHONE_CLIENT: 'Evolution API',
      CONFIG_SESSION_PHONE_NAME: 'Chrome',
      
      // Logging
      LOG_LEVEL: 'INFO,BAILEYS,ERROR',
      
      // Database
      DATABASE_ENABLED: 'true',
      DATABASE_SAVE_DATA_INSTANCE: 'true',
      DATABASE_SAVE_DATA_NEW_MESSAGE: 'true',
      DATABASE_CONNECTION_URI: 'postgresql://user:pass@localhost:5432/evolution',
      DATABASE_CONNECTION_CLIENT_NAME: 'evolution_api_server_1',
      
      // Redis
      CACHE_REDIS_ENABLED: 'true',
      CACHE_REDIS_URI: 'redis://localhost:6379',
      CACHE_REDIS_SAVE_INSTANCES: 'true',
      
      // Server
      SERVER_PORT: '8080',
      SERVER_URL: 'http://localhost:8080',
      
      // Auth
      AUTHENTICATION_API_KEY_KEY: 'your-api-key-here'
    },
    error_file: './logs/evolution-api-error.log',
    out_file: './logs/evolution-api-out.log',
    log_file: './logs/evolution-api-combined.log',
    time: true
  }]
};
```

## Kubernetes - ConfigMap Exemplo

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: evolution-api-config
data:
  # Fix Connection Closed 428
  CONFIG_SESSION_PHONE_VERSION: "2.3000.1015901002"
  CONFIG_SESSION_PHONE_CLIENT: "Evolution API"
  CONFIG_SESSION_PHONE_NAME: "Chrome"
  
  # Logging
  LOG_LEVEL: "INFO,BAILEYS,ERROR"
  
  # Database
  DATABASE_ENABLED: "true"
  DATABASE_SAVE_DATA_INSTANCE: "true"
  DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
  DATABASE_CONNECTION_CLIENT_NAME: "evolution_api_k8s"
  
  # Redis
  CACHE_REDIS_ENABLED: "true"
  CACHE_REDIS_SAVE_INSTANCES: "true"
  
  # Server
  SERVER_PORT: "8080"
```

## Configurações por Tipo de Deploy

### Desenvolvimento Local
```bash
# .env.development
CONFIG_SESSION_PHONE_VERSION=2.3000.1015901002
LOG_LEVEL=DEBUG,INFO,BAILEYS,ERROR
DATABASE_ENABLED=false
CACHE_REDIS_ENABLED=false
```

### Homologação
```bash
# .env.staging
CONFIG_SESSION_PHONE_VERSION=2.3000.1015901002
LOG_LEVEL=INFO,BAILEYS,ERROR
DATABASE_ENABLED=true
CACHE_REDIS_ENABLED=true
DEL_INSTANCE=1800  # 30 min
```

### Produção
```bash
# .env.production
CONFIG_SESSION_PHONE_VERSION=2.3000.1015901002
LOG_LEVEL=INFO,ERROR
DATABASE_ENABLED=true
CACHE_REDIS_ENABLED=true
DEL_INSTANCE=3600  # 1 hora
```

## Scripts de Monitoramento

### Script de Verificação de Status

```bash
#!/bin/bash
# check_evolution_health.sh

API_URL="http://localhost:8080"
API_KEY="your-api-key-here"
INSTANCE_NAME="your-instance"

echo "Checking Evolution API health..."

# Check API health
response=$(curl -s -H "apikey: $API_KEY" "$API_URL/instance/connectionState/$INSTANCE_NAME")
echo "Connection Status: $response"

# Check for error 428 in logs
echo "Checking for Connection Closed errors..."
if command -v pm2 >/dev/null 2>&1; then
    pm2 logs evolution-api --lines 50 | grep -i "connection closed\|428"
elif command -v docker >/dev/null 2>&1; then
    docker logs evolution-api --tail 50 | grep -i "connection closed\|428"
fi

echo "Health check completed."
```

### Script de Restart Automático

```bash
#!/bin/bash
# auto_restart_on_428.sh

API_URL="http://localhost:8080"
API_KEY="your-api-key-here"
INSTANCE_NAME="your-instance"

# Function to check if instance needs restart
check_and_restart() {
    local response=$(curl -s -H "apikey: $API_KEY" "$API_URL/instance/connectionState/$INSTANCE_NAME")
    
    if echo "$response" | grep -q '"state":"close"'; then
        echo "Instance is closed, attempting restart..."
        curl -X POST -H "apikey: $API_KEY" "$API_URL/instance/restart/$INSTANCE_NAME"
        echo "Restart command sent."
    else
        echo "Instance is healthy."
    fi
}

# Run check every 5 minutes
while true; do
    check_and_restart
    sleep 300
done
```

## Troubleshooting Commands

### Verificar Logs de Conexão
```bash
# PM2
pm2 logs evolution-api | grep -E "(Connection|Retry|428|ensureConnected)"

# Docker
docker logs evolution-api | grep -E "(Connection|Retry|428|ensureConnected)"

# Journalctl (systemd)
journalctl -u evolution-api | grep -E "(Connection|Retry|428|ensureConnected)"
```

### Forçar Restart via API
```bash
# Restart instance
curl -X POST "http://localhost:8080/instance/restart/INSTANCE_NAME" \
  -H "apikey: YOUR_API_KEY"

# Check connection state
curl "http://localhost:8080/instance/connectionState/INSTANCE_NAME" \
  -H "apikey: YOUR_API_KEY"
```

### Verificar Versão do WhatsApp em Uso
```bash
# Nos logs, procure por:
grep "Baileys version" /path/to/logs/evolution-api.log

# Deve mostrar algo como:
# "Baileys version env: 2,3000,1015901002 (from CONFIG_SESSION_PHONE_VERSION)"
```
