import { useCallback, useEffect, useRef, useState } from 'react'
import type { BridgeConnectionState, BridgeStatusMessage, GraspCommand } from '../types/protocol'

const RECONNECT_DELAY_MS = 2000

export interface BridgeLogEntry {
	id: number
	direction: 'sent' | 'received' | 'info'
	message: string
	at: string
}

export function useGraspBridge(url: string) {
	const [connectionState, setConnectionState] = useState<BridgeConnectionState>('disconnected')
	const [lastStatus, setLastStatus] = useState<BridgeStatusMessage | null>(null)
	const [log, setLog] = useState<BridgeLogEntry[]>([])
	const wsRef = useRef<WebSocket | null>(null)
	const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const logIdRef = useRef(0)
	const closedByUserRef = useRef(false)

	const pushLog = useCallback((direction: BridgeLogEntry['direction'], message: string) => {
		logIdRef.current += 1
		setLog((prev) => [
			...prev.slice(-49),
			{ id: logIdRef.current, direction, message, at: new Date().toLocaleTimeString() },
		])
	}, [])

	const connect = useCallback(() => {
		closedByUserRef.current = false
		setConnectionState('connecting')
		const ws = new WebSocket(url)
		wsRef.current = ws

		ws.onopen = () => {
			setConnectionState('connected')
			pushLog('info', 'connected to bridge')
		}
		ws.onclose = () => {
			setConnectionState('disconnected')
			pushLog('info', 'bridge connection closed')
			if (!closedByUserRef.current) {
				reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
			}
		}
		ws.onerror = () => {
			setConnectionState('error')
		}
		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as BridgeStatusMessage
				if (data.type === 'status') {
					setLastStatus(data)
					pushLog('received', JSON.stringify(data))
				}
			} catch {
				pushLog('received', String(event.data))
			}
		}
	}, [url, pushLog])

	useEffect(() => {
		connect()
		return () => {
			closedByUserRef.current = true
			if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
			wsRef.current?.close()
		}
	}, [connect])

	const send = useCallback(
		(command: GraspCommand) => {
			const ws = wsRef.current
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				pushLog('info', 'send failed: bridge not connected')
				return false
			}
			ws.send(JSON.stringify(command))
			pushLog('sent', JSON.stringify(command))
			return true
		},
		[pushLog]
	)

	return { connectionState, lastStatus, log, send }
}
