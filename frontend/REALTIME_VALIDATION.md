# Real-time Updates Implementation

## Overview

Implemented WebSocket-based real-time updates with graceful fallback to polling for:
- Transaction status updates
- Live staking reward updates  
- System notifications

## Architecture

### Core Components

1. **useWebSocket Hook** (`hooks/use-websocket.ts`)
   - WebSocket connection management with reconnection logic
   - Automatic fallback to HTTP polling when WebSocket fails
   - Configurable reconnection intervals and max attempts
   - Message parsing and error handling

2. **useRealtimeTransactions Hook** (`hooks/use-realtime-transactions.ts`)
   - Real-time transaction status monitoring
   - Subscription to specific transaction IDs
   - Connection status tracking
   - Transaction state management

3. **useRealtimeStaking Hook** (`hooks/use-realtime-staking.ts`)
   - Live staking reward updates
   - Position status monitoring
   - APY and reward calculations
   - Real-time position tracking

4. **useSystemNotifications Hook** (`hooks/use-system-notifications.ts`)
   - System-wide notifications
   - Toast integration
   - Unread count management
   - Notification history

## Features

### WebSocket Connection
- **Auto-reconnection**: Exponential backoff with configurable max attempts
- **Graceful fallback**: HTTP polling when WebSocket unavailable
- **Connection status**: Real-time connection state tracking
- **Error handling**: Comprehensive error reporting and recovery

### Real-time Updates
- **Transaction Status**: Live updates for pending, confirmed, failed transactions
- **Staking Rewards**: Real-time reward calculations and APY updates
- **System Notifications**: Important events, maintenance, security alerts

### Message Types
```typescript
type WebSocketMessage = {
  type: 'transaction_status' | 'staking_reward' | 'system_notification'
  data: any
  timestamp: string
}
```

## Usage Examples

### Transaction Status Monitoring
```tsx
import { useRealtimeTransactions } from '@/hooks/use-realtime-transactions'

function TransactionMonitor({ transactionIds }) {
  const { 
    transactions, 
    connectionStatus, 
    getTransaction 
  } = useRealtimeTransactions({
    transactionIds,
    onStatusChange: (tx) => console.log('Status changed:', tx),
    onError: (error) => console.error('Connection error:', error)
  })

  const transaction = getTransaction(transactionIds[0])
  
  return (
    <div>
      <div>Connection: {connectionStatus}</div>
      {transaction && (
        <div>Transaction {transaction.id} is {transaction.status}</div>
      )}
    </div>
  )
}
```

### Staking Rewards Monitoring
```tsx
import { useRealtimeStaking } from '@/hooks/use-realtime-staking'

function StakingDashboard({ positionIds }) {
  const { 
    rewards, 
    getTotalRewards, 
    connectionStatus 
  } = useRealtimeStaking({
    positionIds,
    onRewardUpdate: (reward) => console.log('New reward:', reward)
  })

  return (
    <div>
      <div>Total Rewards: ${getTotalRewards()}</div>
      <div>Connection: {connectionStatus}</div>
    </div>
  )
}
```

### System Notifications
```tsx
import { useSystemNotifications } from '@/hooks/use-system-notifications'

function NotificationCenter() {
  const { 
    notifications, 
    unreadCount, 
    markAllAsRead 
  } = useSystemNotifications({
    showToast: true
  })

  return (
    <div>
      <div>Unread: {unreadCount}</div>
      <button onClick={markAllAsRead}>Mark All Read</button>
      {notifications.map(notification => (
        <div key={notification.id}>
          {notification.title}: {notification.message}
        </div>
      ))}
    </div>
  )
}
```

## Environment Configuration

Add to your `.env.local`:
```env
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
# For production:
# NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws
```

## WebSocket Message Protocol

### Client → Server
```json
{
  "type": "subscribe",
  "payload": {
    "transactions": ["tx-1", "tx-2"],
    "staking": ["position-1", "position-2"],
    "notifications": true
  }
}
```

### Server → Client
```json
{
  "type": "transaction_status",
  "data": {
    "id": "tx-1",
    "status": "confirmed",
    "txId": "0x123...",
    "timestamp": "2024-01-01T00:00:00Z"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Testing

### Unit Tests
- WebSocket connection management
- Reconnection logic
- Message handling
- Fallback polling
- Error scenarios

Run tests:
```bash
npm test hooks/__tests__/use-websocket.test.tsx
```

### Manual Testing
1. Start development server
2. Open multiple browser tabs
3. Initiate transactions/staking
4. Verify real-time updates across tabs
5. Test connection resilience (disable/enable network)
6. Verify fallback behavior

## Performance Considerations

### WebSocket Optimization
- Connection pooling for multiple tabs
- Message batching for high-frequency updates
- Compression for large payloads
- Connection health monitoring

### Fallback Polling
- Adaptive polling intervals
- Request deduplication
- Cached responses
- Background sync

## Security

### Authentication
- JWT token-based WebSocket authentication
- Secure token refresh mechanism
- Connection rate limiting
- Message validation

### Data Protection
- Encrypted WebSocket connections (WSS)
- Message integrity verification
- Rate limiting per client
- Audit logging

## Scalability

### Horizontal Scaling
- Redis pub/sub for multi-instance coordination
- Load balancer WebSocket support
- Connection state synchronization
- Graceful failover handling

### Monitoring
- Connection metrics tracking
- Message latency monitoring
- Error rate alerting
- Performance dashboards

## Browser Support

- WebSocket: Chrome 16+, Firefox 11+, Safari 7+, Edge 12+
- Fallback: All browsers with fetch API
- Polyfills available for older browsers

## Troubleshooting

### Common Issues
1. **Connection refused**: Check WebSocket server status
2. **Authentication failed**: Verify JWT tokens
3. **Message not received**: Check subscription payload
4. **High latency**: Monitor network conditions

### Debug Tools
- Browser DevTools Network tab
- WebSocket connection inspector
- Console logging for connection events
- Performance monitoring tools

## Future Enhancements

1. **Message persistence**: Offline message queuing
2. **Push notifications**: Native mobile notifications
3. **Advanced filtering**: Client-side message filtering
4. **Analytics**: Real-time usage metrics
5. **A/B testing**: Feature flags for real-time features
