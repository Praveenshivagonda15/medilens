import React, { useRef, useEffect, useState } from 'react'
import { clinicalGraphInstance, normalizeSaltName } from '../services/interactionService.js'

export default function InteractionGraphVisualizer({ cabinet }) {
  const canvasRef = useRef(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [graphStats, setGraphStats] = useState({ nodesCount: 0, edgesCount: 0, clashesCount: 0 })

  const simulationRef = useRef({
    nodes: [],
    edges: [],
    draggingNode: null,
    mouseX: 0,
    mouseY: 0,
    width: 320,
    height: 240
  })

  useEffect(() => {
    if (!Array.isArray(cabinet) || cabinet.length < 2) return

    const g = clinicalGraphInstance
    const nodesMap = new Map() // canonical key -> node properties
    const edgesList = []

    const addNodeSafe = (id, type, name, extra = {}) => {
      const key = id.toLowerCase()
      if (!nodesMap.has(key)) {
        nodesMap.set(key, {
          id: key,
          type,
          name,
          x: 50 + Math.random() * 220,
          y: 50 + Math.random() * 140,
          vx: 0,
          vy: 0,
          radius: type === 'DRUG' ? 8 : type === 'PATHWAY' ? 10 : 7,
          ...extra
        })
      }
      return key
    }

    const addEdgeSafe = (source, target, type) => {
      const sKey = source.toLowerCase()
      const tKey = target.toLowerCase()
      if (nodesMap.has(sKey) && nodesMap.has(tKey)) {

        const exists = edgesList.some(e => 
          (e.source === sKey && e.target === tKey) || 
          (e.source === tKey && e.target === sKey)
        )
        if (!exists) {
          edgesList.push({ source: sKey, target: tKey, type })
        }
      }
    }

    const brandToSaltMap = new Map()
    cabinet.forEach(item => {
      const brandKey = addNodeSafe(item.brandName, 'DRUG', item.brandName, {
        pillCount: item.pillCount
      })
      const cleanSalt = normalizeSaltName(item.saltComposition)
      if (cleanSalt) {
        brandToSaltMap.set(brandKey, cleanSalt)
      }
    })

    const cabinetSaltsClean = Array.from(brandToSaltMap.values())
    const activeGraphNodes = new Set()
    const collisionsSet = new Set()

    cabinetSaltsClean.forEach(cleanSalt => {

      const nodeKey = Array.from(g.nodes.keys()).find(k => cleanSalt.includes(k) || k.includes(cleanSalt))
      if (nodeKey) {
        activeGraphNodes.add(nodeKey)
      }
    })

    brandToSaltMap.forEach((cleanSalt, brandKey) => {
      const nodeKey = Array.from(g.nodes.keys()).find(k => cleanSalt.includes(k) || k.includes(cleanSalt))
      const saltNameDisp = nodeKey ? g.nodes.get(nodeKey).name : cleanSalt
      const saltKey = addNodeSafe(nodeKey || cleanSalt, 'SALT', saltNameDisp)
      addEdgeSafe(brandKey, saltKey, 'CONTAINS')
    })

    const activeNodesArr = Array.from(activeGraphNodes)
    let clashesCount = 0

    for (let i = 0; i < activeNodesArr.length; i++) {
      for (let j = i + 1; j < activeNodesArr.length; j++) {
        const u = activeNodesArr[i]
        const v = activeNodesArr[j]
        const paths = g.findPaths(u, v, 4)

        paths.forEach(path => {

          const pathwayId = path.find(nId => g.nodes.get(nId)?.type === 'PATHWAY')
          if (pathwayId) {
            clashesCount++
            collisionsSet.add(pathwayId)

            path.forEach(nId => {
              const info = g.nodes.get(nId)
              if (info) {
                addNodeSafe(nId, info.type, info.name, {
                  severity: info.severity,
                  title: info.title
                })
              }
            })

            for (let idx = 0; idx < path.length - 1; idx++) {
              addEdgeSafe(path[idx], path[idx + 1], 'PATHWAY_LINK')
            }
          }
        })
      }
    }

    activeNodesArr.forEach(saltKey => {
      const neighbors = g.edges.get(saltKey) || []
      neighbors.forEach(edge => {
        const targetNode = g.nodes.get(edge.targetId)

        if (targetNode && (targetNode.type === 'CLASS' || targetNode.type === 'SIDEEFFECT')) {

          const isRelatedToClash = Array.from(collisionsSet).some(cId => {
            const pathList = g.findPaths(saltKey, cId, 3)
            return pathList.length > 0
          })

          if (targetNode.type === 'CLASS' || isRelatedToClash) {
            addNodeSafe(edge.targetId, targetNode.type, targetNode.name, {
              description: targetNode.description
            })
            addEdgeSafe(saltKey, edge.targetId, edge.relType)
          }
        }
      })
    })

    if (collisionsSet.size === 0) {
      activeNodesArr.forEach(saltKey => {
        const neighbors = g.edges.get(saltKey) || []
        neighbors.forEach(edge => {
          const targetNode = g.nodes.get(edge.targetId)
          if (targetNode && targetNode.type === 'CLASS') {
            addNodeSafe(edge.targetId, targetNode.type, targetNode.name)
            addEdgeSafe(saltKey, edge.targetId, edge.relType)
          }
        })
      })
    }

    const finalNodes = Array.from(nodesMap.values())
    const finalEdges = edgesList

    simulationRef.current.nodes = finalNodes
    simulationRef.current.edges = finalEdges
    setGraphStats({
      nodesCount: finalNodes.length,
      edgesCount: finalEdges.length,
      clashesCount: collisionsSet.size
    })

    setSelectedNode(null)
    setHoveredNode(null)
  }, [cabinet])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animationFrameId

    const sim = simulationRef.current
    sim.width = canvas.clientWidth
    sim.height = canvas.clientHeight

    const runFrame = () => {

      const nodes = sim.nodes
      const edges = sim.edges
      const width = sim.width
      const height = sim.height

      if (nodes.length > 0) {

        const friction = 0.85

        const kRepel = 240

        const kAttract = 0.05

        const restLength = 55

        const kGravity = 0.015
        const centerX = width / 2
        const centerY = height / 2

        for (let i = 0; i < nodes.length; i++) {
          const u = nodes[i]
          for (let j = i + 1; j < nodes.length; j++) {
            const v = nodes[j]
            const dx = u.x - v.x
            const dy = u.y - v.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            if (dist < 150) {
              const force = kRepel / (dist * dist)
              const fx = (dx / dist) * force
              const fy = (dy / dist) * force
              u.vx += fx
              u.vy += fy
              v.vx -= fx
              v.vy -= fy
            }
          }
        }

        edges.forEach(edge => {
          const u = nodes.find(n => n.id === edge.source)
          const v = nodes.find(n => n.id === edge.target)
          if (u && v) {
            const dx = u.x - v.x
            const dy = u.y - v.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const force = kAttract * (dist - restLength)
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force
            u.vx -= fx
            u.vy -= fy
            v.vx += fx
            v.vy += fy
          }
        })

        nodes.forEach(u => {
          if (u === sim.draggingNode) {
            u.x = sim.mouseX
            u.y = sim.mouseY
            u.vx = 0
            u.vy = 0
          } else {

            u.vx += (centerX - u.x) * kGravity
            u.vy += (centerY - u.y) * kGravity

            u.vx *= friction
            u.vy *= friction
            u.x += u.vx
            u.y += u.vy

            u.x = Math.max(u.radius + 10, Math.min(width - u.radius - 10, u.x))
            u.y = Math.max(u.radius + 10, Math.min(height - u.radius - 10, u.y))
          }
        })
      }

      ctx.clearRect(0, 0, width, height)

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.03)'
      ctx.lineWidth = 1
      const gridSize = 30
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      edges.forEach(edge => {
        const u = nodes.find(n => n.id === edge.source)
        const v = nodes.find(n => n.id === edge.target)
        if (u && v) {
          const isClashLink = edge.type === 'PATHWAY_LINK'
          const isHighlighted = hoveredNode 
            ? (u.id === hoveredNode.id || v.id === hoveredNode.id)
            : true

          ctx.beginPath()
          ctx.moveTo(u.x, u.y)
          ctx.lineTo(v.x, v.y)

          if (isClashLink) {
            ctx.strokeStyle = isHighlighted ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.2)'
            ctx.lineWidth = isHighlighted ? 2.5 : 1.2
            if (isHighlighted) {

              ctx.shadowColor = '#ef4444'
              ctx.shadowBlur = 4
            }
          } else {
            ctx.strokeStyle = isHighlighted ? 'rgba(148, 163, 184, 0.5)' : 'rgba(148, 163, 184, 0.15)'
            ctx.lineWidth = isHighlighted ? 1.5 : 0.8
            ctx.shadowBlur = 0
          }
          
          ctx.stroke()
          ctx.shadowBlur = 0
        }
      })

      nodes.forEach(u => {
        const isHovered = hoveredNode?.id === u.id
        const isSelected = selectedNode?.id === u.id
        const isHighlighted = hoveredNode 
          ? (u.id === hoveredNode.id || edges.some(e => 
              (e.source === u.id && e.target === hoveredNode.id) || 
              (e.target === u.id && e.source === hoveredNode.id)
            ))
          : true

        let color = '#3b82f6'
        let strokeColor = '#2563eb'
        if (u.type === 'DRUG') {
          color = '#10b981'
          strokeColor = '#059669'
        } else if (u.type === 'CLASS') {
          color = '#f59e0b'
          strokeColor = '#d97706'
        } else if (u.type === 'PATHWAY') {
          color = '#ef4444'
          strokeColor = '#dc2626'
        } else if (u.type === 'SIDEEFFECT') {
          color = '#a855f7'
          strokeColor = '#9333ea'
        }

        ctx.beginPath()
        ctx.arc(u.x, u.y, u.radius + (isHovered ? 2 : 0), 0, Math.PI * 2)

        ctx.fillStyle = isHighlighted ? color : `${color}22`
        ctx.fill()
        
        ctx.strokeStyle = isHighlighted ? strokeColor : `${strokeColor}22`
        ctx.lineWidth = isSelected ? 3.0 : 1.5
        
        if (isSelected) {
          ctx.shadowColor = strokeColor
          ctx.shadowBlur = 6
        } else if (u.type === 'PATHWAY' && isHighlighted) {

          const pulse = 2 + Math.sin(Date.now() * 0.005) * 2
          ctx.shadowColor = '#ef4444'
          ctx.shadowBlur = pulse
        }

        ctx.stroke()
        ctx.shadowBlur = 0

        ctx.font = isHovered || isSelected ? 'bold 10px Inter, sans-serif' : '500 9px Inter, sans-serif'
        ctx.fillStyle = isSelected 
          ? '#1e293b' 
          : isHighlighted 
          ? '#475569' 
          : '#94a3b844'
          
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(u.name, u.x, u.y + u.radius + 4)
      })

      animationFrameId = requestAnimationFrame(runFrame)
    }

    runFrame()

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [selectedNode, hoveredNode])

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const nodes = simulationRef.current.nodes

    const clickedNode = nodes.find(n => {
      const dx = n.x - x
      const dy = n.y - y
      return Math.sqrt(dx * dx + dy * dy) < n.radius + 8
    })

    if (clickedNode) {
      simulationRef.current.draggingNode = clickedNode
      setSelectedNode(clickedNode)
    } else {
      setSelectedNode(null)
    }
  }

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    simulationRef.current.mouseX = x
    simulationRef.current.mouseY = y

    const nodes = simulationRef.current.nodes
    if (simulationRef.current.draggingNode) return

    const hoverNode = nodes.find(n => {
      const dx = n.x - x
      const dy = n.y - y
      return Math.sqrt(dx * dx + dy * dy) < n.radius + 8
    })

    setHoveredNode(hoverNode || null)
  }

  const handleMouseUp = () => {
    simulationRef.current.draggingNode = null
  }

  const handleMouseLeave = () => {
    simulationRef.current.draggingNode = null
    setHoveredNode(null)
  }

  if (cabinet.length < 2) return null

  return (
    <div style={{
      background: 'var(--bgsoft)',
      border: '1.5px solid var(--border)',
      borderRadius: 16,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      boxShadow: 'var(--shadow)',
      animation: 'fadeUp 0.3s ease',
      marginTop: 10
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--navy)' }}> Clinical Graph Visualizer</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, background: '#e0f2fe', color: '#0369a1', padding: '1px 8px', borderRadius: 10 }}>
            {graphStats.nodesCount} Nodes
          </span>
          {graphStats.clashesCount > 0 && (
            <span style={{ fontSize: 9.5, fontWeight: 800, background: '#fef2f2', color: '#b91c1c', padding: '1px 8px', borderRadius: 10, animation: 'pulse 1.5s infinite' }}>
              ️ {graphStats.clashesCount} Clashes
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: 11, color: 'var(--textlt)', margin: 0, textAlign: 'left', lineHeight: 1.45 }}>
        Interactive drug-pathway graph. Drag nodes to explore. Hover or click to trace chemical classifications and clash points.
      </p>

      <div style={{ position: 'relative', width: '100%', height: '240px', background: '#fff', borderRadius: 12, border: '1.5px solid var(--border)', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', width: '100%', height: '100%', cursor: hoveredNode ? 'grab' : 'default' }}
          width={400}
          height={240}
        />
      </div>

      <div style={{
        background: '#fff',
        border: '1.5px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        textAlign: 'left',
        minHeight: 56,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}>
        {selectedNode ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--navy)' }}>{selectedNode.name}</span>
              <span style={{ 
                fontSize: 9, 
                fontWeight: 800, 
                color: selectedNode.type === 'DRUG' ? '#047857' : selectedNode.type === 'PATHWAY' ? '#b91c1c' : '#1d4ed8',
                background: selectedNode.type === 'DRUG' ? '#d1fae5' : selectedNode.type === 'PATHWAY' ? '#fef2f2' : '#dbeafe',
                padding: '1px 6px',
                borderRadius: 4
              }}>
                {selectedNode.type} NODE
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--textmd)', margin: 0, lineHeight: 1.4 }}>
              {selectedNode.type === 'DRUG' && `Brand name added to your cabinet. Contains active chemical salts.`}
              {selectedNode.type === 'SALT' && `Active chemical ingredient. Connects to therapeutic class definitions.`}
              {selectedNode.type === 'CLASS' && `Therapeutic drug class. Groups medications with similar biological activity.`}
              {selectedNode.type === 'PATHWAY' && `Critical physiological pathway. Collision here indicates severe toxicity or drug-drug clashes: "${selectedNode.title}" (${selectedNode.severity} risk).`}
              {selectedNode.type === 'SIDEEFFECT' && `Known physiological adverse effect linked to this drug class: "${selectedNode.description}".`}
            </p>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, fontStyle: 'italic', textAlign: 'center' }}>
            Click any node in the graph to inspect clinical classification details.
          </span>
        )}
      </div>
    </div>
  )
}
