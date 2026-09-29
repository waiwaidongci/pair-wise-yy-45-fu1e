import type { Annotation, MergeOutcome, MergeResult, OfflineBatch, RevisionProposal, Sample } from '../api/types'

const CURRENT_ROUND = '第三轮' as const

export type FinalizedMerge = {
  measurements: Record<string, number>
  annotations: Annotation[]
  proposals: RevisionProposal[]
}

/**
 * 三方合并：以批次创建时的快照为基准，
 * 对本机离线修改与正式版本按部位逐字段重算。
 * 同一部位两边都改过 → 双方冲突，两份都保留，等待确认。
 */
export function mergeBatchWithRemote(batch: OfflineBatch, remote: Sample): MergeResult {
  const base = batch.baseSnapshot

  const measurements: MergeResult['measurements'] = base.measurements[CURRENT_ROUND].map((baseItem) => {
    const remoteItem = remote.measurements[CURRENT_ROUND].find((item) => item.key === baseItem.key)
    const remoteValue = remoteItem ? remoteItem.actual : baseItem.actual
    const localValue = batch.measurementEdits[baseItem.key] ?? baseItem.actual
    const localChanged = localValue !== baseItem.actual
    const remoteChanged = remoteValue !== baseItem.actual
    let outcome: MergeOutcome
    if (localChanged && remoteChanged) outcome = localValue === remoteValue ? '双方一致' : '双方冲突'
    else if (localChanged) outcome = '本机离线'
    else if (remoteChanged) outcome = '正式版本'
    else outcome = '双方一致'
    return {
      id: baseItem.key,
      key: baseItem.key,
      part: baseItem.name,
      field: '实测值',
      base: baseItem.actual,
      local: localValue,
      remote: remoteValue,
      outcome,
    }
  })

  const annotations: MergeResult['annotations'] = []
  const baseAnnotations = new Map(base.annotations.map((item) => [item.id, item]))
  for (const item of batch.annotations) {
    const remoteCopy = remote.annotations.find((candidate) => candidate.id === item.id)
    if (remoteCopy && remoteCopy.content !== item.content) {
      annotations.push({ id: item.id, part: item.part, outcome: '双方冲突', local: item, remote: remoteCopy })
    } else {
      annotations.push({ id: item.id, part: item.part, outcome: '本机离线', local: item })
    }
  }
  for (const item of remote.annotations) {
    const baseItem = baseAnnotations.get(item.id)
    if (baseItem) {
      if (baseItem.content !== item.content || baseItem.status !== item.status) {
        annotations.push({ id: item.id, part: item.part, outcome: '正式版本', remote: item })
      }
    } else if (!batch.annotations.some((candidate) => candidate.id === item.id)) {
      annotations.push({ id: item.id, part: item.part, outcome: '正式版本', remote: item })
    }
  }

  const proposals: MergeResult['proposals'] = []
  const baseProposals = new Map(base.proposals.map((item) => [item.id, item]))
  for (const item of batch.proposals) {
    proposals.push({ id: item.id, part: item.affectedPart, outcome: '本机离线', local: item })
  }
  for (const item of remote.proposals) {
    const baseItem = baseProposals.get(item.id)
    if (baseItem) {
      if (baseItem.content !== item.content || baseItem.status !== item.status) {
        proposals.push({ id: item.id, part: item.affectedPart, outcome: '正式版本', remote: item })
      }
    } else if (!batch.proposals.some((candidate) => candidate.id === item.id)) {
      proposals.push({ id: item.id, part: item.affectedPart, outcome: '正式版本', remote: item })
    }
  }

  return {
    mergedAt: new Date().toLocaleString('zh-CN'),
    remoteStatus: remote.status,
    lockedTarget: remote.status === '已锁定',
    measurements,
    annotations,
    proposals,
  }
}

export function mergeHasConflicts(merge: MergeResult): boolean {
  return [...merge.measurements, ...merge.annotations, ...merge.proposals].some((item) => item.outcome === '双方冲突')
}

export function mergeAllResolved(merge: MergeResult): boolean {
  return [...merge.measurements, ...merge.annotations, ...merge.proposals].every(
    (item) => item.outcome !== '双方冲突' || Boolean(item.resolution),
  )
}

/** 冲突确认后计算最终合并结果：基准快照 + 正式版本改动 + 逐字段采用结果。 */
export function finalizeMerge(batch: OfflineBatch, merge: MergeResult): FinalizedMerge {
  const measurements: Record<string, number> = {}
  for (const item of merge.measurements) {
    if (item.outcome === '本机离线') measurements[item.key] = item.local
    else if (item.outcome === '正式版本') measurements[item.key] = item.remote
    else if (item.outcome === '双方冲突') measurements[item.key] = item.resolution === '本机离线' ? item.local : item.remote
    else measurements[item.key] = item.local
  }

  const annotations = batch.baseSnapshot.annotations.map((item) => {
    const remoteMod = merge.annotations.find((candidate) => candidate.id === item.id && candidate.outcome === '正式版本')
    return remoteMod?.remote ? { ...remoteMod.remote } : { ...item }
  })
  for (const item of merge.annotations) {
    if (item.outcome === '正式版本' && item.remote && !annotations.some((candidate) => candidate.id === item.id)) {
      annotations.push({ ...item.remote })
    } else if (item.outcome === '本机离线' && item.local) {
      annotations.push({ ...item.local, origin: '本机离线' })
    } else if (item.outcome === '双方冲突') {
      if (item.resolution === '本机离线' && item.local) annotations.push({ ...item.local, origin: '本机离线' })
      else if (item.remote) annotations.push({ ...item.remote })
    }
  }

  const proposals = batch.baseSnapshot.proposals.map((item) => {
    const remoteMod = merge.proposals.find((candidate) => candidate.id === item.id && candidate.outcome === '正式版本')
    return remoteMod?.remote ? { ...remoteMod.remote } : { ...item }
  })
  for (const item of merge.proposals) {
    if (item.outcome === '正式版本' && item.remote && !proposals.some((candidate) => candidate.id === item.id)) {
      proposals.push({ ...item.remote })
    } else if (item.outcome === '本机离线' && item.local) {
      proposals.push({ ...item.local, origin: '本机离线' })
    } else if (item.outcome === '双方冲突') {
      if (item.resolution === '本机离线' && item.local) proposals.push({ ...item.local, origin: '本机离线' })
      else if (item.remote) proposals.push({ ...item.remote })
    }
  }

  return { measurements, annotations, proposals }
}
