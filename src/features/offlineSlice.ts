import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ChangeLogEntry, MergeResult, OfflineBatch, PendingRevision, Sample } from '../api/types'

type OfflineState = {
  online: boolean
  simulateFailure: boolean
  batches: OfflineBatch[]
  pendingRevisions: PendingRevision[]
  changeLog: ChangeLogEntry[]
}

const storageKey = 'garment-sampling-offline-v1'
const saved = localStorage.getItem(storageKey)

const initialState: OfflineState = saved
  ? JSON.parse(saved)
  : {
      online: true,
      simulateFailure: false,
      batches: [],
      pendingRevisions: [],
      changeLog: [],
    }

const editable = (status: OfflineBatch['status']) => status === '待同步' || status === '合并失败'

const slice = createSlice({
  name: 'offline',
  initialState,
  reducers: {
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
    },
    setSimulateFailure(state, action: PayloadAction<boolean>) {
      state.simulateFailure = action.payload
    },
    createBatch(state, action: PayloadAction<{ id: string; sample: Sample; author: string }>) {
      const { id, sample, author } = action.payload
      state.batches.unshift({
        id,
        sampleId: sample.id,
        styleCode: sample.styleCode,
        author,
        createdAt: new Date().toLocaleString('zh-CN'),
        baseSnapshot: JSON.parse(JSON.stringify(sample)) as Sample,
        measurementEdits: {},
        annotations: [],
        proposals: [],
        status: '待同步',
        attempts: 0,
      })
    },
    updateBatchMeasurement(state, action: PayloadAction<{ batchId: string; key: string; actual: number }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || !editable(batch.status)) return
      const base = batch.baseSnapshot.measurements['第三轮'].find((item) => item.key === action.payload.key)
      if (base && action.payload.actual === base.actual) delete batch.measurementEdits[action.payload.key]
      else batch.measurementEdits[action.payload.key] = action.payload.actual
    },
    addBatchAnnotation(state, action: PayloadAction<{ batchId: string; part: string; content: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || !editable(batch.status)) return
      batch.annotations.push({
        id: `AN-O-${String(Date.now()).slice(-6)}`,
        x: 50,
        y: 40,
        part: action.payload.part,
        content: action.payload.content,
        author: `${batch.author}（离线）`,
        status: '待处理',
        origin: '本机离线',
      })
    },
    addBatchProposal(state, action: PayloadAction<{ batchId: string; affectedPart: string; content: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || !editable(batch.status)) return
      batch.proposals.push({
        id: `RV-O-${String(Date.now()).slice(-6)}`,
        author: batch.author,
        role: '版师 · 离线批次',
        content: action.payload.content,
        affectedPart: action.payload.affectedPart,
        status: '待决定',
        origin: '本机离线',
      })
    },
    batchMergeStarted(state, action: PayloadAction<{ batchId: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      batch.status = '合并中'
      batch.attempts += 1
      batch.error = undefined
    },
    batchMerged(state, action: PayloadAction<{ batchId: string; merge: MergeResult }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      batch.merge = action.payload.merge
      const hasConflict = [...action.payload.merge.measurements, ...action.payload.merge.annotations, ...action.payload.merge.proposals].some(
        (item) => item.outcome === '双方冲突',
      )
      batch.status = hasConflict ? '待确认' : '合并中'
    },
    batchMergeFailed(state, action: PayloadAction<{ batchId: string; error: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      // 批次内容原样保留，只记录失败原因，可再次重试
      batch.status = '合并失败'
      batch.error = action.payload.error
    },
    resolveConflict(state, action: PayloadAction<{ batchId: string; kind: 'measurement' | 'annotation' | 'proposal'; id: string; choice: '本机离线' | '正式版本' }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch?.merge || batch.status !== '待确认') return
      const groups = {
        measurement: batch.merge.measurements,
        annotation: batch.merge.annotations,
        proposal: batch.merge.proposals,
      } as const
      const item = (groups[action.payload.kind] as Array<{ id: string; outcome: string; resolution?: '本机离线' | '正式版本' }>).find(
        (entry) => entry.id === action.payload.id,
      )
      if (item && item.outcome === '双方冲突') item.resolution = action.payload.choice
    },
    batchApplied(state, action: PayloadAction<{ batchId: string; target: '正式版本' | '待审修订'; summary: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      batch.status = '已合并'
      batch.appliedTo = action.payload.target
      state.changeLog.unshift({
        id: `LOG-${Date.now()}`,
        date: new Date().toLocaleString('zh-CN'),
        sampleId: batch.sampleId,
        source: '本机离线',
        summary: action.payload.summary,
      })
    },
    addPendingRevision(state, action: PayloadAction<PendingRevision>) {
      state.pendingRevisions.unshift(action.payload)
    },
  },
})

export const {
  setOnline,
  setSimulateFailure,
  createBatch,
  updateBatchMeasurement,
  addBatchAnnotation,
  addBatchProposal,
  batchMergeStarted,
  batchMerged,
  batchMergeFailed,
  resolveConflict,
  batchApplied,
  addPendingRevision,
} = slice.actions
export const offlineReducer = slice.reducer
