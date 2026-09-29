import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined'
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import {
  addBatchAnnotation,
  addBatchProposal,
  addPendingRevision,
  batchApplied,
  batchMergeFailed,
  batchMerged,
  batchMergeStarted,
  createBatch,
  resolveConflict,
  setOnline,
  setSimulateFailure,
  updateBatchMeasurement,
} from '../features/offlineSlice'
import { applyMergedResult } from '../features/developmentSlice'
import { finalizeMerge, mergeAllResolved, mergeBatchWithRemote, mergeHasConflicts } from '../features/merge'
import type { MergeOutcome, MergeResult, OfflineBatch, Sample } from '../api/types'

const batchStatusColor: Record<OfflineBatch['status'], 'default' | 'primary' | 'success' | 'warning' | 'error'> = {
  待同步: 'warning',
  合并中: 'primary',
  待确认: 'error',
  已合并: 'success',
  合并失败: 'error',
}

const outcomeColor: Record<MergeOutcome, 'default' | 'primary' | 'success' | 'error'> = {
  本机离线: 'primary',
  正式版本: 'success',
  双方一致: 'default',
  双方冲突: 'error',
}

const editableStatus = (batch: OfflineBatch) => batch.status === '待同步' || batch.status === '合并失败'

export default function OfflineBatchesPage() {
  const dispatch = useAppDispatch()
  const development = useAppSelector((root) => root.development)
  const offline = useAppSelector((root) => root.offline)
  const selectedSample = development.samples.find((item) => item.id === development.selectedId) ?? development.samples[0]
  const [activeId, setActiveId] = useState<string | null>(null)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState({ part: '版型', content: '' })
  const [proposalDraft, setProposalDraft] = useState({ affectedPart: '肩袖', content: '' })
  const activeBatch = offline.batches.find((item) => item.id === activeId) ?? offline.batches[0]
  const samplePending = offline.pendingRevisions

  const applyMerge = async (batch: OfflineBatch, merge: MergeResult) => {
    const final = finalizeMerge(batch, merge)
    const localParts = merge.measurements
      .filter((item) => item.outcome === '本机离线' || (item.outcome === '双方冲突' && item.resolution === '本机离线'))
      .map((item) => item.part)
    if (merge.lockedTarget) {
      // 锁定版本只进入待审修订，不改原记录
      dispatch(
        addPendingRevision({
          id: `PR-${String(Date.now()).slice(-6)}`,
          batchId: batch.id,
          sampleId: batch.sampleId,
          styleCode: batch.styleCode,
          createdAt: new Date().toLocaleString('zh-CN'),
          source: `离线批次 ${batch.id} · 本机离线`,
          status: '待审',
          summary: `正式版本已锁定，合并结果（${localParts.length ? `本机修改：${localParts.join('、')}` : '无本机尺寸修改'}）仅进入待审修订，锁定快照未改动。`,
          measurements: merge.measurements
            .filter((item) => item.outcome !== '双方一致')
            .map((item) => ({
              key: item.key,
              part: item.part,
              actual: final.measurements[item.key],
              origin: item.outcome === '双方冲突' ? item.resolution ?? '正式版本' : item.outcome,
            })),
          annotations: final.annotations.filter((item) => item.origin === '本机离线'),
          proposals: final.proposals.filter((item) => item.origin === '本机离线'),
        }),
      )
      dispatch(
        batchApplied({
          batchId: batch.id,
          target: '待审修订',
          summary: `批次 ${batch.id} 合并完成：正式版本已锁定，结果进入待审修订，原记录未改动。`,
        }),
      )
      return
    }
    const response = await fetch(`/api/samples/${batch.sampleId}/apply-merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(final),
    })
    if (!response.ok) throw new Error(`合并结果写入正式版本失败（HTTP ${response.status}）`)
    dispatch(applyMergedResult({ sampleId: batch.sampleId, ...final }))
    dispatch(
      batchApplied({
        batchId: batch.id,
        target: '正式版本',
        summary: `批次 ${batch.id} 合并入正式版本：${localParts.length} 个部位采用本机实测、${batch.annotations.length} 条离线批注、${batch.proposals.length} 个离线方案。`,
      }),
    )
  }

  const runSync = async (batch: OfflineBatch) => {
    dispatch(batchMergeStarted({ batchId: batch.id }))
    try {
      if (!offline.online) throw new Error('当前处于离线模式，恢复联网后再同步')
      if (offline.simulateFailure) throw new Error('正式服务器返回 503，合并中止（模拟故障）')
      const response = await fetch(`/api/samples/${batch.sampleId}`)
      if (!response.ok) throw new Error(`正式版本获取失败（HTTP ${response.status}）`)
      const remote = (await response.json()) as Sample
      const merge = mergeBatchWithRemote(batch, remote)
      dispatch(batchMerged({ batchId: batch.id, merge }))
      if (!mergeHasConflicts(merge)) await applyMerge(batch, merge)
    } catch (error) {
      dispatch(batchMergeFailed({ batchId: batch.id, error: error instanceof Error ? error.message : '未知错误' }))
    }
  }

  const confirmMerge = async (batch: OfflineBatch) => {
    if (!batch.merge || !mergeAllResolved(batch.merge)) return
    try {
      await applyMerge(batch, batch.merge)
    } catch (error) {
      dispatch(batchMergeFailed({ batchId: batch.id, error: error instanceof Error ? error.message : '未知错误' }))
    }
  }

  const simulateRemoteEdit = async () => {
    const sampleId = activeBatch?.sampleId ?? selectedSample.id
    await fetch(`/api/samples/${sampleId}/remote-edit`, { method: 'POST' })
  }

  const startBatch = () => {
    const id = `OB-${String(Date.now()).slice(-6)}`
    dispatch(createBatch({ id, sample: selectedSample, author: '周研' }))
    setActiveId(id)
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">OFFLINE SYNC / 离线修订批次</Typography>
          <Typography component="h1" fontWeight={800}>断网本机修订 · 联网逐字段合并</Typography>
          <Typography color="text.secondary">
            离线期间的尺寸实测、批注和替代方案先保存在本机批次；联网后与正式版本按部位逐字段重算，冲突保留两份等待确认。
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <FormControlLabel
            control={<Switch checked={!offline.online} onChange={(event) => dispatch(setOnline(!event.target.checked))} />}
            label="离线模式"
          />
          <FormControlLabel
            control={
              <Switch checked={offline.simulateFailure} onChange={(event) => dispatch(setSimulateFailure(event.target.checked))} />
            }
            label="模拟合并故障"
          />
          <Button variant="outlined" onClick={simulateRemoteEdit} disabled={!offline.online}>
            模拟正式版本变更
          </Button>
          <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={startBatch}>
            新建离线批次
          </Button>
        </Stack>
      </Box>

      {!offline.online && (
        <Alert severity="warning" icon={<CloudOffOutlinedIcon />} sx={{ mb: 1.5 }}>
          当前处于离线模式：所有修改仅保存在本机批次中，联网后再与正式版本合并。
        </Alert>
      )}
      {offline.online && (
        <Alert severity="info" icon={<CloudDoneOutlinedIcon />} sx={{ mb: 1.5 }}>
          已连接正式版本。可先点击「模拟正式版本变更」制造差异，再同步批次查看逐字段合并结果。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '300px minmax(0,1fr)' }, gap: 1.5 }}>
        <Box className="panel" sx={{ alignSelf: 'start', overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid #ece9e4' }}>
            <Typography fontWeight={800}>本机批次 · {offline.batches.length}</Typography>
          </Box>
          {offline.batches.length === 0 && (
            <Typography color="text.secondary" fontSize={12} sx={{ p: 2 }}>
              还没有离线批次。点击「新建离线批次」为当前款式 {selectedSample.styleCode} 建立本机修订快照。
            </Typography>
          )}
          {offline.batches.map((batch) => (
            <Box
              key={batch.id}
              onClick={() => setActiveId(batch.id)}
              sx={{
                p: 1.5,
                borderBottom: '1px solid #efede9',
                cursor: 'pointer',
                bgcolor: activeBatch?.id === batch.id ? '#edf4f1' : 'transparent',
                boxShadow: activeBatch?.id === batch.id ? 'inset 3px 0 #2d7b72' : 'none',
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800} fontSize={13}>{batch.id} · {batch.styleCode}</Typography>
                <Chip size="small" label={batch.status} color={batchStatusColor[batch.status]} />
              </Stack>
              <Typography color="text.secondary" fontSize={11} mt={0.5}>
                {batch.author} · {batch.createdAt} · 来源：本机离线
              </Typography>
              <Typography color="text.secondary" fontSize={11}>
                {Object.keys(batch.measurementEdits).length} 项尺寸 · {batch.annotations.length} 条批注 · {batch.proposals.length} 个方案
                {batch.attempts > 0 ? ` · 已尝试 ${batch.attempts} 次` : ''}
              </Typography>
              {batch.error && (
                <Typography color="error" fontSize={11} mt={0.5}>失败原因：{batch.error}</Typography>
              )}
              <Stack direction="row" spacing={1} mt={0.8}>
                {(batch.status === '待同步' || batch.status === '合并失败') && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!offline.online}
                    startIcon={batch.status === '合并失败' ? <ReplayOutlinedIcon /> : <SyncOutlinedIcon />}
                    onClick={(event) => {
                      event.stopPropagation()
                      void runSync(batch)
                    }}
                  >
                    {batch.status === '合并失败' ? '重试合并' : '同步合并'}
                  </Button>
                )}
                {batch.status === '待确认' && <Chip size="small" color="error" variant="outlined" label="存在冲突，等待确认" />}
                {batch.status === '已合并' && batch.appliedTo && <Chip size="small" variant="outlined" label={`去向：${batch.appliedTo}`} />}
              </Stack>
            </Box>
          ))}
        </Box>

        <Stack spacing={1.5} sx={{ minWidth: 0 }}>
          {!activeBatch && (
            <Box className="panel" sx={{ p: 3 }}>
              <Typography color="text.secondary">选择或新建一个离线批次查看详情。</Typography>
            </Box>
          )}

          {activeBatch && editableStatus(activeBatch) && (
            <Box className="panel">
              <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography fontWeight={800}>{activeBatch.id} · 本机编辑中</Typography>
                  <Typography color="text.secondary" fontSize={11}>
                    基准快照：{activeBatch.createdAt} · 来源：本机离线 · 修改不会影响正式版本
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SyncOutlinedIcon />}
                  disabled={!offline.online}
                  onClick={() => void runSync(activeBatch)}
                >
                  联网同步合并
                </Button>
              </Box>

              {activeBatch.status === '合并失败' && (
                <Alert severity="error" sx={{ m: 1.5 }}>
                  合并失败：{activeBatch.error}。批次内容已原样保留，可直接重试。
                  <Button size="small" sx={{ ml: 1 }} variant="outlined" disabled={!offline.online} onClick={() => void runSync(activeBatch)}>
                    立即重试
                  </Button>
                </Alert>
              )}

              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 560 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f6f5f2' }}>
                      <TableCell>部位</TableCell>
                      <TableCell>基准快照（第三轮）</TableCell>
                      <TableCell>本机实测</TableCell>
                      <TableCell>状态</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activeBatch.baseSnapshot.measurements['第三轮'].map((item) => {
                      const edited = activeBatch.measurementEdits[item.key]
                      const changed = typeof edited === 'number'
                      return (
                        <TableRow key={item.key} sx={{ bgcolor: changed ? '#eef4fb' : 'transparent' }}>
                          <TableCell sx={{ fontWeight: 750 }}>{item.name}</TableCell>
                          <TableCell>{item.actual.toFixed(1)} cm</TableCell>
                          <TableCell sx={{ maxWidth: 130 }}>
                            <TextField
                              size="small"
                              type="number"
                              inputProps={{ step: 0.1 }}
                              value={changed ? edited : item.actual}
                              onChange={(event) => {
                                const next = Number.parseFloat(event.target.value)
                                if (!Number.isNaN(next)) {
                                  dispatch(updateBatchMeasurement({ batchId: activeBatch.id, key: item.key, actual: next }))
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip size="small" label={changed ? '本机已修改' : '未改动'} color={changed ? 'primary' : 'default'} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </Box>

              <Divider />
              <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography fontWeight={800} fontSize={13}>离线批注 · {activeBatch.annotations.length}</Typography>
                    <Button size="small" startIcon={<AddOutlinedIcon />} onClick={() => setAnnotationOpen(true)}>添加批注</Button>
                  </Stack>
                  <Stack spacing={1}>
                    {activeBatch.annotations.map((item) => (
                      <Box key={item.id} sx={{ p: 1.2, borderLeft: '3px solid #2d6fb7', bgcolor: '#f4f7fb', borderRadius: 1 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center">
                          <Typography fontWeight={800} fontSize={12}>{item.part}</Typography>
                          <Chip size="small" label="来源：本机离线" color="primary" variant="outlined" />
                        </Stack>
                        <Typography color="text.secondary" fontSize={11} mt={0.4}>{item.content}</Typography>
                      </Box>
                    ))}
                    {activeBatch.annotations.length === 0 && (
                      <Typography color="text.secondary" fontSize={12}>暂无离线批注。</Typography>
                    )}
                  </Stack>
                </Box>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography fontWeight={800} fontSize={13}>离线替代方案 · {activeBatch.proposals.length}</Typography>
                    <Button size="small" startIcon={<AddOutlinedIcon />} onClick={() => setProposalOpen(true)}>添加方案</Button>
                  </Stack>
                  <Stack spacing={1}>
                    {activeBatch.proposals.map((item) => (
                      <Box key={item.id} sx={{ p: 1.2, borderLeft: '3px solid #2d6fb7', bgcolor: '#f4f7fb', borderRadius: 1 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center">
                          <Typography fontWeight={800} fontSize={12}>{item.affectedPart}</Typography>
                          <Chip size="small" label="来源：本机离线" color="primary" variant="outlined" />
                        </Stack>
                        <Typography color="text.secondary" fontSize={11} mt={0.4}>{item.content}</Typography>
                      </Box>
                    ))}
                    {activeBatch.proposals.length === 0 && (
                      <Typography color="text.secondary" fontSize={12}>暂无离线替代方案。</Typography>
                    )}
                  </Stack>
                </Box>
              </Box>
            </Box>
          )}

          {activeBatch && activeBatch.status === '合并中' && (
            <Box className="panel" sx={{ p: 3 }}>
              <Typography fontWeight={800}>正在与正式版本合并…</Typography>
              <Typography color="text.secondary" fontSize={12} mt={0.5}>按部位逐字段比对基准快照、本机修改与正式版本。</Typography>
            </Box>
          )}

          {activeBatch?.merge && (activeBatch.status === '待确认' || activeBatch.status === '已合并') && (
            <Box className="panel">
              <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4' }}>
                <Typography fontWeight={800}>合并结果 · {activeBatch.merge.mergedAt}</Typography>
                <Typography color="text.secondary" fontSize={11}>
                  正式版本状态：{activeBatch.merge.remoteStatus} · 三方来源：基准快照 / 本机离线 / 正式版本
                </Typography>
              </Box>

              {activeBatch.merge.lockedTarget && (
                <Alert severity="warning" sx={{ m: 1.5 }}>
                  正式版本已锁定：合并结果只进入待审修订，不会改动锁定快照与原记录。
                </Alert>
              )}
              {activeBatch.status === '待确认' && (
                <Alert severity="error" sx={{ m: 1.5 }}>
                  同一部位两边都改过，两个版本均已保留。请逐项确认采用哪一份，确认前不会写入任何记录。
                </Alert>
              )}

              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 680 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f6f5f2' }}>
                      <TableCell>部位 / 字段</TableCell>
                      <TableCell>基准快照</TableCell>
                      <TableCell>本机离线</TableCell>
                      <TableCell>正式版本</TableCell>
                      <TableCell>重算结果</TableCell>
                      <TableCell>冲突确认</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activeBatch.merge.measurements.map((item) => (
                      <TableRow key={item.id} sx={{ bgcolor: item.outcome === '双方冲突' ? '#fdeeee' : 'transparent' }}>
                        <TableCell sx={{ fontWeight: 750 }}>{item.part} · {item.field}</TableCell>
                        <TableCell>{item.base.toFixed(1)}</TableCell>
                        <TableCell sx={{ color: '#2d5f8a', fontWeight: 700 }}>{item.local.toFixed(1)}</TableCell>
                        <TableCell sx={{ color: '#2d7665', fontWeight: 700 }}>{item.remote.toFixed(1)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={item.outcome} color={outcomeColor[item.outcome]} />
                        </TableCell>
                        <TableCell>
                          {item.outcome === '双方冲突' && activeBatch.status === '待确认' && (
                            <Stack direction="row" spacing={0.6}>
                              <Button
                                size="small"
                                variant={item.resolution === '本机离线' ? 'contained' : 'outlined'}
                                onClick={() =>
                                  dispatch(resolveConflict({ batchId: activeBatch.id, kind: 'measurement', id: item.id, choice: '本机离线' }))
                                }
                              >
                                本机 {item.local.toFixed(1)}
                              </Button>
                              <Button
                                size="small"
                                variant={item.resolution === '正式版本' ? 'contained' : 'outlined'}
                                color="success"
                                onClick={() =>
                                  dispatch(resolveConflict({ batchId: activeBatch.id, kind: 'measurement', id: item.id, choice: '正式版本' }))
                                }
                              >
                                正式 {item.remote.toFixed(1)}
                              </Button>
                            </Stack>
                          )}
                          {item.outcome === '双方冲突' && activeBatch.status === '已合并' && (
                            <Chip size="small" variant="outlined" label={`已采用：${item.resolution}`} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>

              <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
                <Box>
                  <Typography fontWeight={800} fontSize={13} mb={1}>批注合并 · {activeBatch.merge.annotations.length}</Typography>
                  <Stack spacing={1}>
                    {activeBatch.merge.annotations.map((item) => (
                      <Box key={item.id} sx={{ p: 1.2, border: '1px solid #e4e1dc', borderRadius: 1 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap">
                          <Typography fontWeight={800} fontSize={12}>{item.part} · {item.id}</Typography>
                          <Chip size="small" label={item.outcome} color={outcomeColor[item.outcome]} />
                        </Stack>
                        <Typography color="text.secondary" fontSize={11} mt={0.4}>
                          {(item.local ?? item.remote)?.content}
                        </Typography>
                        {item.outcome === '双方冲突' && item.remote && (
                          <Typography color="error" fontSize={11} mt={0.4}>正式版本：{item.remote.content}</Typography>
                        )}
                      </Box>
                    ))}
                    {activeBatch.merge.annotations.length === 0 && (
                      <Typography color="text.secondary" fontSize={12}>批注无差异。</Typography>
                    )}
                  </Stack>
                </Box>
                <Box>
                  <Typography fontWeight={800} fontSize={13} mb={1}>替代方案合并 · {activeBatch.merge.proposals.length}</Typography>
                  <Stack spacing={1}>
                    {activeBatch.merge.proposals.map((item) => (
                      <Box key={item.id} sx={{ p: 1.2, border: '1px solid #e4e1dc', borderRadius: 1 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap">
                          <Typography fontWeight={800} fontSize={12}>{item.part} · {item.id}</Typography>
                          <Chip size="small" label={item.outcome} color={outcomeColor[item.outcome]} />
                        </Stack>
                        <Typography color="text.secondary" fontSize={11} mt={0.4}>
                          {(item.local ?? item.remote)?.content}
                        </Typography>
                      </Box>
                    ))}
                    {activeBatch.merge.proposals.length === 0 && (
                      <Typography color="text.secondary" fontSize={12}>替代方案无差异。</Typography>
                    )}
                  </Stack>
                </Box>
              </Box>

              {activeBatch.status === '待确认' && (
                <Box sx={{ p: 1.5, borderTop: '1px solid #ece9e4', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    disabled={!mergeAllResolved(activeBatch.merge)}
                    onClick={() => void confirmMerge(activeBatch)}
                  >
                    {activeBatch.merge.lockedTarget ? '确认并送入待审修订' : '确认并应用合并结果'}
                  </Button>
                </Box>
              )}
              {activeBatch.status === '已合并' && (
                <Alert severity="success" sx={{ m: 1.5 }}>
                  合并完成，去向：{activeBatch.appliedTo}。批次与本机修改记录已归档保留。
                </Alert>
              )}
            </Box>
          )}

          <Box className="panel">
            <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4' }}>
              <Typography fontWeight={800}>待审修订 · {samplePending.length}</Typography>
              <Typography color="text.secondary" fontSize={11}>锁定版本的离线合并结果在此等待负责人审核，原记录与锁定快照保持不变。</Typography>
            </Box>
            {samplePending.length === 0 && (
              <Typography color="text.secondary" fontSize={12} sx={{ p: 2 }}>暂无待审修订。</Typography>
            )}
            {samplePending.map((item) => (
              <Box key={item.id} sx={{ p: 1.6, borderBottom: '1px solid #efede9' }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography fontWeight={800} fontSize={13}>{item.id} · {item.styleCode}</Typography>
                  <Chip size="small" color="warning" label={item.status} />
                  <Chip size="small" variant="outlined" label={`来源：${item.source}`} />
                </Stack>
                <Typography color="text.secondary" fontSize={12} mt={0.6}>{item.summary}</Typography>
                <Stack direction="row" spacing={0.8} flexWrap="wrap" mt={0.8}>
                  {item.measurements.map((measurement) => (
                    <Chip
                      key={measurement.key}
                      size="small"
                      variant="outlined"
                      label={`${measurement.part} → ${measurement.actual.toFixed(1)}（${measurement.origin}）`}
                    />
                  ))}
                  {item.annotations.map((annotation) => (
                    <Chip key={annotation.id} size="small" variant="outlined" label={`批注 ${annotation.part}（本机离线）`} />
                  ))}
                  {item.proposals.map((proposal) => (
                    <Chip key={proposal.id} size="small" variant="outlined" label={`方案 ${proposal.affectedPart}（本机离线）`} />
                  ))}
                </Stack>
                <Typography color="#8a918d" fontSize={10} mt={0.8}>提交时间：{item.createdAt} · 批次 {item.batchId}</Typography>
              </Box>
            ))}
          </Box>
        </Stack>
      </Box>

      <Dialog open={annotationOpen} onClose={() => setAnnotationOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加离线批注</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="详细部位" value={annotationDraft.part} onChange={(event) => setAnnotationDraft({ ...annotationDraft, part: event.target.value })} />
            <TextField multiline minRows={3} label="批注内容" value={annotationDraft.content} onChange={(event) => setAnnotationDraft({ ...annotationDraft, content: event.target.value })} />
            <Typography color="text.secondary" fontSize={12}>批注将保存在本机批次中，联网合并时标注来源「本机离线」。</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotationOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!annotationDraft.part.trim() || !annotationDraft.content.trim() || !activeBatch}
            onClick={() => {
              if (!activeBatch) return
              dispatch(addBatchAnnotation({ batchId: activeBatch.id, part: annotationDraft.part, content: annotationDraft.content }))
              setAnnotationDraft({ part: '版型', content: '' })
              setAnnotationOpen(false)
            }}
          >
            保存到本机批次
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={proposalOpen} onClose={() => setProposalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加离线替代方案</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="影响部位" value={proposalDraft.affectedPart} onChange={(event) => setProposalDraft({ ...proposalDraft, affectedPart: event.target.value })} />
            <TextField multiline minRows={3} label="方案内容" value={proposalDraft.content} onChange={(event) => setProposalDraft({ ...proposalDraft, content: event.target.value })} />
            <Typography color="text.secondary" fontSize={12}>方案将保存在本机批次中，联网合并时标注来源「本机离线」。</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProposalOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!proposalDraft.affectedPart.trim() || !proposalDraft.content.trim() || !activeBatch}
            onClick={() => {
              if (!activeBatch) return
              dispatch(addBatchProposal({ batchId: activeBatch.id, affectedPart: proposalDraft.affectedPart, content: proposalDraft.content }))
              setProposalDraft({ affectedPart: '肩袖', content: '' })
              setProposalOpen(false)
            }}
          >
            保存到本机批次
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
