import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  ChangeSource,
  MergePartResult,
  OfflineBatch,
  OfflineChange,
  PendingRevision,
} from '../../api/types'
import { mergeBatch, summarizePart } from './merge'

export type SubmitPayload = {
  batchId: string
  snapshot: {
    measurements: Record<string, Array<Record<string, unknown>>>
    annotations: Array<Record<string, unknown>>
    proposals: Array<Record<string, unknown>>
  }
  officialVersion: number
  official: {
    measurements: Record<string, Array<Record<string, unknown>>>
    annotations: Array<Record<string, unknown>>
    proposals: Array<Record<string, unknown>>
  }
  forceFail?: boolean
}

type OfflineBatchState = {
  batches: OfflineBatch[]
  pendingRevisions: PendingRevision[]
  activeBatchId: string | null
}

const storageKey = 'garment-sampling-offline-batch-v1'

function loadState(): OfflineBatchState {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return {
    batches: [
      {
        id: 'OB-2601',
        sampleId: 'SMP-26018',
        sampleCode: 'WR-26AW-018',
        sampleName: '海盐弧线工装外套',
        status: '待合并',
        note: '工厂离线评审：更新第三轮胸围实测，采纳肩线方案。',
        createdAt: '2026-09-28 09:10',
        updatedAt: '2026-09-28 09:10',
        changes: [
          {
            id: 'CH-01',
            kind: 'measurement',
            partKey: '第三轮:chest',
            partName: '胸围',
            round: '第三轮',
            fields: { actual: 110.9 },
            source: 'offline-batch',
            createdAt: '2026-09-28 09:10',
          },
          {
            id: 'CH-02',
            kind: 'proposal',
            partKey: 'RV-01',
            partName: '肩袖',
            fields: { status: '已采纳' },
            source: 'offline-batch',
            createdAt: '2026-09-28 09:12',
          },
        ],
      },
      {
        id: 'OB-2602',
        sampleId: 'SMP-26018',
        sampleCode: 'WR-26AW-018',
        sampleName: '海盐弧线工装外套',
        status: '合并失败',
        note: '工厂离线批注批次，联网时中断。',
        createdAt: '2026-09-27 18:20',
        updatedAt: '2026-09-27 18:20',
        failureReason: '联网中断：无法获取正式版本（演示失败）',
        changes: [
          {
            id: 'CH-03',
            kind: 'annotation',
            partKey: 'AN-01',
            partName: '领口',
            fields: { content: '领尖略外翘，收窄 0.8cm 并增加领底衬（工厂复核）。' },
            source: 'offline-batch',
            createdAt: '2026-09-27 18:20',
          },
        ],
      },
    ],
    pendingRevisions: [],
    activeBatchId: null,
  }
}

const initialState: OfflineBatchState = loadState()

function buildPendingRevision(
  batch: OfflineBatch,
  result: MergePartResult,
  source: ChangeSource,
): PendingRevision {
  const payload: Record<string, unknown> = {}
  for (const field of result.fields) {
    if (field.changedBy === 'none') continue
    if (source === 'offline-batch' && field.changedBy === 'official') continue
    if (source === 'official' && field.changedBy === 'local') continue
    payload[field.field] = source === 'offline-batch' ? field.local : field.official
  }
  return {
    id: `PR-${batch.id}-${result.partKey}`,
    batchId: batch.id,
    sampleId: batch.sampleId,
    sampleCode: batch.sampleCode,
    partKey: result.partKey,
    partName: result.partName,
    kind: result.kind,
    source,
    summary: summarizePart(result),
    payload,
    status: '待审',
    createdAt: new Date().toLocaleString('zh-CN'),
  }
}

const slice = createSlice({
  name: 'offlineBatch',
  initialState,
  reducers: {
    createBatch(state, action: PayloadAction<{ sampleId: string; sampleCode: string; sampleName: string; note: string }>) {
      const id = `OB-${String(state.batches.length + 1).padStart(4, '0')}`
      const now = new Date().toLocaleString('zh-CN')
      state.batches.unshift({
        id,
        sampleId: action.payload.sampleId,
        sampleCode: action.payload.sampleCode,
        sampleName: action.payload.sampleName,
        status: '草稿',
        note: action.payload.note,
        changes: [],
        createdAt: now,
        updatedAt: now,
      })
      state.activeBatchId = id
    },
    addChange(state, action: PayloadAction<{ batchId: string; change: Omit<OfflineChange, 'id' | 'source' | 'createdAt'> }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      const now = new Date().toLocaleString('zh-CN')
      batch.changes.push({
        ...action.payload.change,
        id: `CH-${Date.now()}`,
        source: 'offline-batch',
        createdAt: now,
      })
      batch.status = '草稿'
      batch.updatedAt = now
    },
    removeChange(state, action: PayloadAction<{ batchId: string; changeId: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      batch.changes = batch.changes.filter((item) => item.id !== action.payload.changeId)
      batch.updatedAt = new Date().toLocaleString('zh-CN')
    },
    deleteBatch(state, action: PayloadAction<string>) {
      state.batches = state.batches.filter((item) => item.id !== action.payload)
      if (state.activeBatchId === action.payload) state.activeBatchId = null
    },
    setActiveBatch(state, action: PayloadAction<string | null>) {
      state.activeBatchId = action.payload
    },
    /** 提交合并：以锁定快照为基准逐部位字段级重算 */
    submitBatch(state, action: PayloadAction<SubmitPayload>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      batch.status = '合并中'
      batch.updatedAt = new Date().toLocaleString('zh-CN')

      if (action.payload.forceFail) {
        batch.status = '合并失败'
        batch.failureReason = '联网中断：无法获取正式版本（演示失败）'
        return
      }

      const outcome = mergeBatch(action.payload.snapshot, batch.changes, action.payload.official)
      batch.officialVersion = action.payload.officialVersion
      batch.mergedAt = new Date().toLocaleString('zh-CN')
      batch.mergeResults = outcome.results
      batch.failureReason = undefined

      if (outcome.hasConflict) {
        batch.status = '待确认'
      } else if (outcome.changedCount === 0) {
        batch.status = '合并成功'
      } else {
        batch.status = '合并成功'
        // 无冲突：为每个有变更的部位生成待审修订
        for (const result of outcome.results) {
          if (result.status === 'clean') {
            const source: ChangeSource = result.fields.some((f) => f.changedBy === 'local') ? 'offline-batch' : 'official'
            state.pendingRevisions.unshift(buildPendingRevision(batch, result, source))
          }
        }
      }
    },
    /** 重试失败的合并：批次原样保留，重新走合并流程 */
    retryMerge(state, action: PayloadAction<SubmitPayload>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      batch.failureReason = undefined
      // 复用 submitBatch 逻辑
      slice.caseReducers.submitBatch(state, action)
    },
    /** 确认冲突部位保留哪一方，确认后生成待审修订 */
    resolveConflict(state, action: PayloadAction<{ batchId: string; partKey: string; side: 'local' | 'official' | 'both' }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || !batch.mergeResults) return
      const result = batch.mergeResults.find((item) => item.partKey === action.payload.partKey)
      if (!result || result.status !== 'conflict') return
      result.confirmedSide = action.payload.side

      // 若所有冲突都已确认，批次转为合并成功并生成待审修订
      const allResolved = batch.mergeResults.every((item) => item.status !== 'conflict' || item.confirmedSide)
      if (allResolved) {
        batch.status = '合并成功'
        for (const item of batch.mergeResults) {
          if (item.status === 'conflict' && item.confirmedSide) {
            const source: ChangeSource = item.confirmedSide === 'official' ? 'official' : 'offline-batch'
            state.pendingRevisions.unshift(buildPendingRevision(batch, item, source))
          }
        }
      }
    },
    confirmRevision(state, action: PayloadAction<string>) {
      const revision = state.pendingRevisions.find((item) => item.id === action.payload)
      if (revision) revision.status = '已确认'
    },
    rejectRevision(state, action: PayloadAction<string>) {
      const revision = state.pendingRevisions.find((item) => item.id === action.payload)
      if (revision) revision.status = '已驳回'
    },
  },
})

export const {
  createBatch,
  addChange,
  removeChange,
  deleteBatch,
  setActiveBatch,
  submitBatch,
  retryMerge,
  resolveConflict,
  confirmRevision,
  rejectRevision,
} = slice.actions

export const offlineBatchReducer = slice.reducer
