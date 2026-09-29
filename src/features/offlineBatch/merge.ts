import type { MergeFieldResult, MergePartResult, OfflineChange } from '../../api/types'

/** 各类型参与合并的字段定义 */
export const measurementFields = [
  { field: 'spec', label: '规格' },
  { field: 'actual', label: '实测' },
  { field: 'tolerance', label: '容差' },
]

export const annotationFields = [
  { field: 'x', label: '横坐标' },
  { field: 'y', label: '纵坐标' },
  { field: 'part', label: '部位' },
  { field: 'content', label: '批注内容' },
  { field: 'status', label: '状态' },
]

export const proposalFields = [
  { field: 'content', label: '方案内容' },
  { field: 'affectedPart', label: '影响部位' },
  { field: 'status', label: '状态' },
]

export function fieldDefsForKind(kind: OfflineChange['kind']) {
  switch (kind) {
    case 'measurement':
      return measurementFields
    case 'annotation':
      return annotationFields
    case 'proposal':
      return proposalFields
  }
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/**
 * 对单个部位做逐字段三路合并。
 * base = 锁定快照，local = 离线批次，official = 正式版本。
 * 仅当同一字段两边都改时才判为冲突，保留两份副本等待确认。
 */
export function mergePart(
  kind: OfflineChange['kind'],
  partKey: string,
  partName: string,
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  official: Record<string, unknown> | undefined,
): MergePartResult {
  const fieldDefs = fieldDefsForKind(kind)
  const fields: MergeFieldResult[] = fieldDefs.map(({ field, label }) => {
    const baseVal = base?.[field]
    const localVal = local?.[field] ?? baseVal
    const officialVal = official?.[field] ?? baseVal
    const localChanged = !isEqual(localVal, baseVal)
    const officialChanged = !isEqual(officialVal, baseVal)
    let changedBy: MergeFieldResult['changedBy'] = 'none'
    if (localChanged && officialChanged) changedBy = 'both'
    else if (localChanged) changedBy = 'local'
    else if (officialChanged) changedBy = 'official'
    return { field, label, base: baseVal, local: localVal, official: officialVal, changedBy }
  })

  const hasConflict = fields.some((item) => item.changedBy === 'both')
  const hasChange = fields.some((item) => item.changedBy !== 'none')

  return {
    partKey,
    partName,
    kind,
    status: hasConflict ? 'conflict' : hasChange ? 'clean' : 'unchanged',
    fields,
    localCopy: hasConflict ? local : undefined,
    officialCopy: hasConflict ? official : undefined,
    confirmedSide: null,
  }
}

/** 将离线变更应用到快照记录上，得到本机侧记录 */
export function applyOfflineChanges(
  base: Record<string, unknown> | undefined,
  changes: OfflineChange[],
): Record<string, unknown> | undefined {
  if (!base) return undefined
  const result: Record<string, unknown> = { ...base }
  for (const change of changes) {
    for (const [field, value] of Object.entries(change.fields)) {
      result[field] = value
    }
  }
  return result
}

export type NormalizedSample = {
  measurements: Record<string, Record<string, unknown>>
  annotations: Record<string, Record<string, unknown>>
  proposals: Record<string, Record<string, unknown>>
}

/** 把 Sample 结构归一化为 partKey -> record 的映射 */
export function normalizeSample(sample: {
  measurements: Record<string, Array<Record<string, unknown>>>
  annotations: Array<Record<string, unknown>>
  proposals: Array<Record<string, unknown>>
}): NormalizedSample {
  const measurements: Record<string, Record<string, unknown>> = {}
  for (const [round, list] of Object.entries(sample.measurements)) {
    for (const item of list) {
      measurements[`${round}:${String(item.key)}`] = item
    }
  }
  const annotations: Record<string, Record<string, unknown>> = {}
  for (const item of sample.annotations) {
    annotations[String(item.id)] = item
  }
  const proposals: Record<string, Record<string, unknown>> = {}
  for (const item of sample.proposals) {
    proposals[String(item.id)] = item
  }
  return { measurements, annotations, proposals }
}

/** 从归一化结构中取某部位记录 */
function pickRecord(normalized: NormalizedSample, kind: OfflineChange['kind'], partKey: string) {
  if (kind === 'measurement') return normalized.measurements[partKey]
  if (kind === 'annotation') return normalized.annotations[partKey]
  return normalized.proposals[partKey]
}

/** 取部位中文名 */
function partNameFor(
  kind: OfflineChange['kind'],
  partKey: string,
  fallback: string,
  base: Record<string, unknown> | undefined,
): string {
  if (kind === 'measurement') return String(base?.name ?? fallback)
  if (kind === 'annotation') return String(base?.part ?? fallback)
  return String(base?.affectedPart ?? fallback)
}

export type MergeOutcome = {
  results: MergePartResult[]
  hasConflict: boolean
  changedCount: number
}

/**
 * 合并一个批次：以锁定快照为基准，逐部位对比本机离线变更与正式版本。
 * 同一部位两边都改 -> conflict，保留两份副本；否则取有变更的一方。
 */
export function mergeBatch(
  snapshot: {
    measurements: Record<string, Array<Record<string, unknown>>>
    annotations: Array<Record<string, unknown>>
    proposals: Array<Record<string, unknown>>
  },
  changes: OfflineChange[],
  official: {
    measurements: Record<string, Array<Record<string, unknown>>>
    annotations: Array<Record<string, unknown>>
    proposals: Array<Record<string, unknown>>
  },
): MergeOutcome {
  const baseNorm = normalizeSample(snapshot)
  const officialNorm = normalizeSample(official)

  // 收集所有涉及的 partKey（快照 + 离线 + 正式）
  const keysByKind: Record<OfflineChange['kind'], Set<string>> = {
    measurement: new Set(Object.keys(baseNorm.measurements)),
    annotation: new Set(Object.keys(baseNorm.annotations)),
    proposal: new Set(Object.keys(baseNorm.proposals)),
  }
  for (const change of changes) keysByKind[change.kind].add(change.partKey)
  for (const key of Object.keys(officialNorm.measurements)) keysByKind.measurement.add(key)
  for (const key of Object.keys(officialNorm.annotations)) keysByKind.annotation.add(key)
  for (const key of Object.keys(officialNorm.proposals)) keysByKind.proposal.add(key)

  const results: MergePartResult[] = []
  for (const kind of ['measurement', 'annotation', 'proposal'] as const) {
    for (const partKey of keysByKind[kind]) {
      const base = pickRecord(baseNorm, kind, partKey)
      const officialRecord = pickRecord(officialNorm, kind, partKey)
      const partChanges = changes.filter((item) => item.kind === kind && item.partKey === partKey)
      const local = partChanges.length > 0 ? applyOfflineChanges(base, partChanges) : base
      const partName = partNameFor(kind, partKey, partChanges[0]?.partName ?? partKey, base)
      const merged = mergePart(kind, partKey, partName, base, local, officialRecord)
      if (merged.status !== 'unchanged') results.push(merged)
    }
  }

  return {
    results,
    hasConflict: results.some((item) => item.status === 'conflict'),
    changedCount: results.length,
  }
}

/** 根据合并结果生成待审修订摘要 */
export function summarizePart(result: MergePartResult): string {
  const changed = result.fields.filter((item) => item.changedBy !== 'none')
  if (result.status === 'conflict') {
    return `与正式版本在 ${changed.map((item) => item.label).join('、')} 上两边都做了修改，已保留两份副本等待确认`
  }
  const side = result.fields[0]?.changedBy === 'local' ? '离线批次' : '正式版本'
  return `${side}更新了 ${changed.map((item) => item.label).join('、')}`
}
