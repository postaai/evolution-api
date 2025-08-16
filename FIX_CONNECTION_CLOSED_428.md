# Fix: Connection Closed (428 - Precondition Required) - Evolution API

## Resumo da Causa Raiz

O erro "Connection Closed (428 - Precondition Required)" foi causado por vários problemas estruturais:

1. **Reconexão automática imediata sem delay**: Quando a conexão era fechada, o código tentava reconectar imediatamente sem dar tempo para o socket ser limpo adequadamente.

2. **Falta de verificação do estado do socket**: Mensagens eram enviadas sem verificar se o socket estava realmente aberto.

3. **Ausência de sistema de retry**: Não havia tratamento de retry para erros transitórios como o 428.

4. **Potencial conflito de sessão**: Não havia proteção contra múltiplas tentativas de reconexão simultâneas.

5. **Falta de logs estruturados**: Não havia logs adequados para monitorar o estado da versão do WhatsApp sendo aplicada.

## Arquivos Alterados

### Novos Arquivos:
- `src/api/integrations/channel/whatsapp/connection-manager.ts` - Gerenciamento de conexão com retry controlado
- `src/api/integrations/channel/whatsapp/message-sender.ts` - Envio de mensagens com retry e idempotência

### Arquivos Modificados:
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` - Integração com os novos sistemas

## Funcionalidades Implementadas

### 1. Gerenciamento de Conexão Controlada (`ConnectionManager`)
- **Single-flight pattern**: Previne reconexões concorrentes
- **Reconexão controlada**: Aguarda cleanup adequado antes de reconectar
- **Backoff exponencial**: Delay crescente entre tentativas de reconexão
- **Detecção de estados irrecuperáveis**: Não tenta reconectar se loggedOut

### 2. Envio de Mensagens com Retry (`MessageSender`)
- **Retry com backoff**: Tentativas com delay exponencial para erros transitórios
- **Idempotência**: Previne envio duplicado da mesma mensagem
- **Validação de conexão**: Verifica se socket está aberto antes de enviar
- **Classificação de erros**: Distingue entre erros retryable e permanentes

### 3. Melhorias no BaileysStartupService
- **Integração com ConnectionManager**: Reconexões controladas
- **Logging melhorado**: Visibilidade da versão do WhatsApp sendo aplicada
- **Cleanup adequado**: Limpeza de estado durante logout/restart

## Instruções de Implantação

### 1. Backup
```bash
# Backup dos arquivos importantes
cp src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts.backup
```

### 2. Aplicar as Mudanças
Os arquivos já foram criados/modificados no repositório. Certifique-se de que:

```bash
# Verificar se os novos arquivos existem
ls -la src/api/integrations/channel/whatsapp/connection-manager.ts
ls -la src/api/integrations/channel/whatsapp/message-sender.ts
```

### 3. Configuração Recomendada

Adicione/verifique estas variáveis no seu `.env`:

```bash
# Versão específica do WhatsApp (recomendado para estabilidade)
CONFIG_SESSION_PHONE_VERSION=2.3000.1015901002

# Keep-alive (já configurado no código)
# connectTimeoutMs=30000
# keepAliveIntervalMs=30000

# Configurações de log para monitoramento
LOG_LEVEL=INFO,BAILEYS,ERROR
```

### 4. Reiniciar a Aplicação
```bash
# PM2
pm2 restart evolution-api

# Docker
docker-compose restart evolution-api

# Modo desenvolvimento
npm run start:dev
```

### 5. Verificação Pós-Deploy

#### A. Logs de Inicialização
Verifique se aparecem logs similares a:
```
[BaileysStartupService] Using configured WhatsApp version: 2.3000.1015901002
[BaileysStartupService] Baileys version env: 2,3000,1015901002 (from CONFIG_SESSION_PHONE_VERSION)
```

#### B. Teste de Envio de Mensagem
```bash
curl -X POST "http://localhost:8080/message/sendText/INSTANCE_NAME" \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_API_KEY" \
  -d '{
    "number": "5511999999999",
    "text": "Teste após correção do erro 428"
  }'
```

#### C. Monitoramento de Logs
```bash
# PM2
pm2 logs evolution-api | grep -E "(Connection|Retry|428)"

# Docker
docker logs evolution-api | grep -E "(Connection|Retry|428)"
```

## Monitoramento Pós-Implantação

### Logs a Observar

#### 1. Reconexão Controlada ✅
```
[ConnectionManager] [INSTANCE_NAME] Connection not open (close), initiating controlled reconnection
[ConnectionManager] [INSTANCE_NAME] Reconnection attempt 1/3
[ConnectionManager] [INSTANCE_NAME] Reconnection successful
```

#### 2. Retry de Mensagens ✅
```
[MessageSender] Sending message attempt 1/3 to 5511999999999@s.whatsapp.net
[MessageSender] Message sent successfully to 5511999999999@s.whatsapp.net
```

#### 3. Prevenção de Concorrência ✅
```
[ConnectionManager] [INSTANCE_NAME] Already reconnecting, waiting...
```

### Problemas a Monitorar

#### 1. Falha Persistente ❌
```
[ConnectionManager] Failed to reconnect after 3 attempts
```
**Ação**: Verificar conectividade de rede e estado da sessão

#### 2. Muitos Retries ❌
```
[MessageSender] Failed to send message after 3 attempts
```
**Ação**: Verificar se a instância está autenticada

#### 3. Conflito de Sessão ❌
```
[BaileysStartupService] Connection closed. Status code: 428, Should reconnect: true
```
**Ação**: Verificar se não há múltiplas instâncias usando a mesma sessão

## Rollback (se necessário)

### 1. Restaurar Backup
```bash
cp src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts.backup src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
```

### 2. Remover Arquivos Novos
```bash
rm src/api/integrations/channel/whatsapp/connection-manager.ts
rm src/api/integrations/channel/whatsapp/message-sender.ts
```

### 3. Reiniciar
```bash
pm2 restart evolution-api
```

## Parâmetros de Configuração

### Variáveis de Ambiente Importantes

| Variável | Valor Recomendado | Descrição |
|----------|------------------|-----------|
| `CONFIG_SESSION_PHONE_VERSION` | `2.3000.1015901002` | Versão específica do WhatsApp Web |
| `LOG_LEVEL` | `INFO,BAILEYS,ERROR` | Nível de logs para monitoramento |

### Configurações Internas (já aplicadas)

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `maxRetries` | 3 | Máximo de tentativas de reconexão |
| `baseDelayMs` | 1000ms | Delay base entre tentativas |
| `maxDelayMs` | 30000ms | Delay máximo entre tentativas |
| `connectTimeoutMs` | 30000ms | Timeout para conexão |
| `keepAliveIntervalMs` | 30000ms | Intervalo de keep-alive |

## Resultados Esperados

Após a implantação, você deve observar:

✅ **Envio bem-sucedido após período de inatividade/erro 428**
✅ **Reconexão controlada após fechamento**
✅ **Ausência de loops/reconexões em tempestade**
✅ **Logs estruturados mostrando versão do WhatsApp**
✅ **Retry automático para erros transitórios**

## Suporte

Se você encontrar problemas após a implantação:

1. Verifique os logs conforme descrito acima
2. Certifique-se de que `CONFIG_SESSION_PHONE_VERSION` está definida
3. Monitore se há múltiplas instâncias usando a mesma sessão
4. Use o endpoint de restart via API se necessário: `POST /instance/restart/INSTANCE_NAME`
