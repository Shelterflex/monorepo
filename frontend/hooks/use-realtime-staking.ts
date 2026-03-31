import { useEffect, useState } from 'react'
import { useWebSocket, type WebSocketMessage } from './use-websocket'
import type { StakingPosition } from '@/lib/ngnStakingApi'

export interface StakingRewardUpdate {
  positionId: string
  rewards: number
  apy: number
  timestamp: string
}

export interface StakingPositionUpdate {
  positionId: string
  status: 'active' | 'completed' | 'failed'
  amount?: number
  rewards?: number
  maturityDate?: string
  timestamp: string
}

export interface UseRealtimeStakingOptions {
  positionIds?: string[]
  onRewardUpdate?: (update: StakingRewardUpdate) => void
  onPositionUpdate?: (update: StakingPositionUpdate) => void
  onError?: (error: Error) => void
}

export function useRealtimeStaking(options: UseRealtimeStakingOptions = {}) {
  const { positionIds, onRewardUpdate, onPositionUpdate, onError } = options
  const [positions, setPositions] = useState<Map<string, StakingPosition>>(new Map())
  const [rewards, setRewards] = useState<Map<string, StakingRewardUpdate>>(new Map())
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')

  // Get WebSocket URL from environment or use default
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 
    (typeof window !== 'undefined' && window.location.protocol === 'https:' 
      ? `wss://${window.location.host}/ws` 
      : `ws://${window.location.host}/ws`)

  const { 
    isConnected, 
    isConnecting, 
    error, 
    lastMessage, 
    send 
  } = useWebSocket({
    url: wsUrl,
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
    enableFallback: true,
    fallbackPollInterval: 5000,
  })

  // Update connection status - use setTimeout to avoid synchronous setState
  useEffect(() => {
    const timer = setTimeout(() => {
      const newStatus = isConnecting ? 'connecting' : 
                      isConnected ? 'connected' : 
                      error ? 'error' : 'disconnected'
      setConnectionStatus(newStatus)
    }, 0)
    return () => clearTimeout(timer)
  }, [isConnecting, isConnected, error])

  // Handle incoming messages - use setTimeout to avoid synchronous setState
  useEffect(() => {
    if (!lastMessage) return

    switch (lastMessage.type) {
      case 'staking_reward': {
        const rewardData = lastMessage.data as StakingRewardUpdate
        
        const timer = setTimeout(() => {
          setRewards(prev => {
            const newMap = new Map(prev)
            newMap.set(rewardData.positionId, rewardData)
            return newMap
          })
        }, 0)

        onRewardUpdate?.(rewardData)
        return () => clearTimeout(timer)
      }

      case 'staking_position': {
        const positionData = lastMessage.data as StakingPositionUpdate
        
        const timer = setTimeout(() => {
          setPositions(prev => {
            const newMap = new Map(prev)
            const existingPosition = newMap.get(positionData.positionId)
            
            if (existingPosition) {
              const updatedPosition: StakingPosition = {
                ...existingPosition,
                status: positionData.status,
                rewards: positionData.rewards || existingPosition.rewards,
                maturityDate: positionData.maturityDate || existingPosition.maturityDate,
              }
              newMap.set(positionData.positionId, updatedPosition)
            }
            
            return newMap
          })
        }, 0)

        onPositionUpdate?.(positionData)
        return () => clearTimeout(timer)
      }
    }
  }, [lastMessage, onRewardUpdate, onPositionUpdate])

  // Subscribe to specific positions
  useEffect(() => {
    if (!isConnected || !positionIds?.length) return

    const timer = setTimeout(() => {
      // Subscribe to staking updates
      send({
        type: 'subscribe',
        payload: {
          staking: positionIds
        }
      })
    }, 0)
    
    return () => clearTimeout(timer)
  }, [isConnected, positionIds, send])

  // Handle errors
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        onError?.(error)
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [error, onError])

  const getPosition = (positionId: string): StakingPosition | undefined => {
    return positions.get(positionId)
  }

  const getReward = (positionId: string): StakingRewardUpdate | undefined => {
    return rewards.get(positionId)
  }

  const getAllPositions = (): StakingPosition[] => {
    return Array.from(positions.values())
  }

  const getAllRewards = (): StakingRewardUpdate[] => {
    return Array.from(rewards.values())
  }

  const getTotalRewards = (): number => {
    return Array.from(rewards.values()).reduce((total, reward) => total + reward.rewards, 0)
  }

  return {
    positions,
    rewards,
    connectionStatus,
    isConnected,
    isConnecting,
    error,
    getPosition,
    getReward,
    getAllPositions,
    getAllRewards,
    getTotalRewards,
  }
}
