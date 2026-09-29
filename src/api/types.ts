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
}

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
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

/** 记录来源：正式版本（服务器）或离线修订批次（本机） */
export type ChangeSource = 'official' | 'offline-batch'

/** 离线批次状态 */
export type BatchStatus = '草稿' | '待合并' | '合并中' | '合并成功' | '合并失败' | '待确认'

/** 批次内单条离线变更，定位到具体部位 */
export type OfflineChange = {
  id: string
  kind: 'measurement' | 'annotation' | 'proposal'
  partKey: string
  partName: string
  round?: '第一轮' | '第二轮' | '第三轮'
  /** 变更后的字段值（仅包含被修改的字段） */
  fields: Record<string, unknown>
  source: 'offline-batch'
  createdAt: string
}

/** 离线修订批次 */
export type OfflineBatch = {
  id: string
  sampleId: string
  sampleCode: string
  sampleName: string
  status: BatchStatus
  changes: OfflineChange[]
  createdAt: string
  updatedAt: string
  note: string
  /** 合并时对齐的正式版本号 */
  officialVersion?: number
  mergedAt?: string
  failureReason?: string
  /** 逐部位字段级合并结果 */
  mergeResults?: MergePartResult[]
}

/** 字段级合并结果 */
export type MergeFieldResult = {
  field: string
  label: string
  base: unknown
  local: unknown
  official: unknown
  changedBy: 'none' | 'local' | 'official' | 'both'
}

/** 部位级合并结果 */
export type MergePartResult = {
  partKey: string
  partName: string
  kind: 'measurement' | 'annotation' | 'proposal'
  status: 'unchanged' | 'clean' | 'conflict'
  fields: MergeFieldResult[]
  /** 冲突时保留的两份副本 */
  localCopy?: Record<string, unknown>
  officialCopy?: Record<string, unknown>
  /** 确认保留的一方 */
  confirmedSide?: 'local' | 'official' | 'both' | null
}

/** 待审修订：锁定版本合并后不覆盖原记录，单独进入待审 */
export type PendingRevision = {
  id: string
  batchId: string
  sampleId: string
  sampleCode: string
  partKey: string
  partName: string
  kind: 'measurement' | 'annotation' | 'proposal'
  source: ChangeSource
  summary: string
  payload: Record<string, unknown>
  status: '待审' | '已确认' | '已驳回'
  createdAt: string
}
