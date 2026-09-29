import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { seedSamples } from '../api/seed'
import type { Sample } from '../api/types'

type Decision = { proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }

/** 锁定快照：审核锁定时固化的版本，作为离线合并的基准，不可覆盖 */
export type SampleSnapshot = {
  sample: Sample
  lockedAt: string
}

type DevelopmentState = {
  samples: Sample[]
  selectedId: string
  roundA: '第一轮' | '第二轮' | '第三轮'
  roundB: '第一轮' | '第二轮' | '第三轮'
  decisions: Decision[]
  draftNotes: Record<string, string>
  locked: boolean
  activeAnnotation: string | null
  /** 各样品的锁定快照，key 为 sampleId */
  snapshots: Record<string, SampleSnapshot>
}

const storageKey = 'garment-sampling-draft-v1'
const saved = localStorage.getItem(storageKey)

const initialState: DevelopmentState = saved
  ? JSON.parse(saved)
  : {
      samples: structuredClone(seedSamples),
      selectedId: seedSamples[0].id,
      roundA: '第二轮',
      roundB: '第三轮',
      decisions: [],
      draftNotes: {},
      locked: false,
      activeAnnotation: null,
      snapshots: {
        'SMP-26018': {
          sample: structuredClone(seedSamples[0]),
          lockedAt: '2026-09-28 10:00',
        },
      },
    }

const slice = createSlice({
  name: 'development',
  initialState,
  reducers: {
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: DevelopmentState['roundA']; b?: DevelopmentState['roundB'] }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    decideProposal(state, action: PayloadAction<Decision>) {
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (!sample || state.locked) return
      state.decisions.push(action.payload)
      const proposal = sample.proposals.find((item) => item.id === action.payload.proposalId)
      if (proposal) proposal.status = action.payload.decision
    },
    saveDraft(state, action: PayloadAction<{ sampleId: string; notes: string }>) {
      state.draftNotes[action.payload.sampleId] = action.payload.notes
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
    resolveAnnotation(state, action: PayloadAction<{ sampleId: string; annotationId: string }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      const annotation = sample?.annotations.find((item) => item.id === action.payload.annotationId)
      if (annotation) annotation.status = annotation.status === '待处理' ? '已解决' : '待处理'
    },
    lockReview(state) {
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (!sample) return
      sample.status = '已锁定'
      sample.proposals.forEach((proposal) => {
        if (proposal.status === '待决定') proposal.status = '未采纳'
      })
      // 固化锁定快照，作为离线合并基准，后续不可覆盖
      state.snapshots[sample.id] = { sample: structuredClone(sample), lockedAt: new Date().toLocaleString('zh-CN') }
      state.locked = true
    },
    unlockReview(state) {
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (sample) sample.status = '待审核'
      state.locked = false
    },
    /** 为尚未锁定的样品手动创建快照（离线合并基准） */
    ensureSnapshot(state, action: PayloadAction<string>) {
      const sample = state.samples.find((item) => item.id === action.payload)
      if (!sample) return
      if (!state.snapshots[sample.id]) {
        state.snapshots[sample.id] = { sample: structuredClone(sample), lockedAt: new Date().toLocaleString('zh-CN') }
      }
    },
  },
})

export const {
  selectSample,
  setRounds,
  decideProposal,
  saveDraft,
  toggleAnnotation,
  resolveAnnotation,
  lockReview,
  unlockReview,
  ensureSnapshot,
} = slice.actions
export const developmentReducer = slice.reducer
