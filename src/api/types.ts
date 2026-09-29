export type Measurement = {
  key: string
  name: string
  spec: number
  actual: number
  tolerance: number
}

export type Annotation = {
  id: string
  x: number
  y: number
  part: string
  content: string
  author: string
  status: '待处理' | '已解决'
  origin?: '本机离线' | '正式版本'
}

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
  origin?: '本机离线' | '正式版本'
}

export type Sample = {
  id: string
  styleCode: string
  styleName: string
  category: string
  developmentSeason: string
  supplier: string
  dueDate: string
  owner: string
  status: '开发中' | '待审核' | '已锁定'
  fabric: string
  colorway: string
  craft: string[]
  measurements: Record<'第一轮' | '第二轮' | '第三轮', Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: Array<{ id: string; author: string; content: string; date: string }>
}

export type MergeOutcome = '本机离线' | '正式版本' | '双方一致' | '双方冲突'

export type MeasurementMerge = {
  id: string
  key: string
  part: string
  field: string
  base: number
  local: number
  remote: number
  outcome: MergeOutcome
  resolution?: '本机离线' | '正式版本'
}

export type AnnotationMerge = {
  id: string
  part: string
  outcome: MergeOutcome
  local?: Annotation
  remote?: Annotation
  resolution?: '本机离线' | '正式版本'
}

export type ProposalMerge = {
  id: string
  part: string
  outcome: MergeOutcome
  local?: RevisionProposal
  remote?: RevisionProposal
  resolution?: '本机离线' | '正式版本'
}

export type MergeResult = {
  mergedAt: string
  remoteStatus: Sample['status']
  lockedTarget: boolean
  measurements: MeasurementMerge[]
  annotations: AnnotationMerge[]
  proposals: ProposalMerge[]
}

export type OfflineBatch = {
  id: string
  sampleId: string
  styleCode: string
  author: string
  createdAt: string
  baseSnapshot: Sample
  measurementEdits: Record<string, number>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  status: '待同步' | '合并中' | '待确认' | '已合并' | '合并失败'
  error?: string
  attempts: number
  merge?: MergeResult
  appliedTo?: '正式版本' | '待审修订'
}

export type PendingRevision = {
  id: string
  batchId: string
  sampleId: string
  styleCode: string
  createdAt: string
  source: string
  status: '待审'
  summary: string
  measurements: Array<{ key: string; part: string; actual: number; origin: string }>
  annotations: Annotation[]
  proposals: RevisionProposal[]
}

export type ChangeLogEntry = {
  id: string
  date: string
  sampleId: string
  source: string
  summary: string
}
