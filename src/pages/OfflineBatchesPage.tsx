import { useMemo, useState } from 'react'
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
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import CloudSyncIcon from '@mui/icons-material/CloudSync'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import {
  addChange,
  createBatch,
  deleteBatch,
  removeChange,
  resolveConflict,
  retryMerge,
  setActiveBatch,
  submitBatch,
  type SubmitPayload,
} from '../features/offlineBatch/offlineBatchSlice'
import { ensureSnapshot } from '../features/developmentSlice'
import { useLazyGetOfficialVersionQuery } from '../app/api'
import type { BatchStatus, MergePartResult, OfflineBatch, OfflineChange } from '../api/types'
import { fieldDefsForKind } from '../features/offlineBatch/merge'

const statusColor: Record<BatchStatus, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  草稿: 'default',
  待合并: 'info',
  合并中: 'info',
  合并成功: 'success',
  合并失败: 'error',
  待确认: 'warning',
}

const sourceLabel: Record<'local' | 'official' | 'both', string> = {
  local: '离线批次',
  official: '正式版本',
  both: '两边保留',
}

function SourceChip({ source }: { source: 'official' | 'offline-batch' }) {
  return (
    <Chip
      size="small"
      label={source === 'official' ? '正式版本' : '离线批次'}
      color={source === 'official' ? 'default' : 'secondary'}
      variant={source === 'official' ? 'outlined' : 'filled'}
      sx={{ height: 20, fontSize: 10 }}
    />
  )
}

export default function OfflineBatchesPage() {
  const dispatch = useAppDispatch()
  const { samples, snapshots } = useAppSelector((state) => state.development)
  const { batches, pendingRevisions, activeBatchId } = useAppSelector((state) => state.offlineBatch)
  const [createOpen, setCreateOpen] = useState(false)
  const [addChangeOpen, setAddChangeOpen] = useState(false)
  const [forceFail, setForceFail] = useState(false)
  const [newBatch, setNewBatch] = useState({ sampleId: '', note: '' })
  const [changeDraft, setChangeDraft] = useState<{
    kind: OfflineChange['kind']
    partKey: string
    fields: Record<string, unknown>
  }>({ kind: 'measurement', partKey: '', fields: {} })

  const [fetchOfficial, { isFetching }] = useLazyGetOfficialVersionQuery()

  const activeBatch = batches.find((item) => item.id === activeBatchId) ?? batches[0]
  const activeSample = activeBatch ? samples.find((item) => item.id === activeBatch.sampleId) : undefined
  const activeSnapshot = activeBatch ? snapshots[activeBatch.sampleId] : undefined

  const pendingForBatch = (batchId: string) => pendingRevisions.filter((item) => item.batchId === batchId)

  const handleCreate = () => {
    const sample = samples.find((item) => item.id === newBatch.sampleId)
    if (!sample) return
    dispatch(createBatch({ sampleId: sample.id, sampleCode: sample.styleCode, sampleName: sample.styleName, note: newBatch.note }))
    dispatch(ensureSnapshot(sample.id))
    setCreateOpen(false)
    setNewBatch({ sampleId: '', note: '' })
  }

  const runMerge = async (batch: OfflineBatch, isRetry: boolean) => {
    dispatch(ensureSnapshot(batch.sampleId))
    const currentSample = samples.find((item) => item.id === batch.sampleId)
    const snapshot = snapshots[batch.sampleId]?.sample ?? currentSample
    if (!snapshot) return
    try {
      const official = await fetchOfficial(batch.sampleId).unwrap()
      const payload: SubmitPayload = {
        batchId: batch.id,
        snapshot: snapshot as unknown as SubmitPayload['snapshot'],
        officialVersion: official.version,
        official: official as unknown as SubmitPayload['official'],
        forceFail,
      }
      if (isRetry) dispatch(retryMerge(payload))
      else dispatch(submitBatch(payload))
    } catch {
      // 联网失败：批次原样保留，标记失败可重试
      const payload: SubmitPayload = {
        batchId: batch.id,
        snapshot: snapshot as unknown as SubmitPayload['snapshot'],
        officialVersion: 0,
        official: { measurements: {}, annotations: [], proposals: [] },
        forceFail: true,
      }
      if (isRetry) dispatch(retryMerge(payload))
      else dispatch(submitBatch(payload))
    }
  }

  const openAddChange = () => {
    setChangeDraft({ kind: 'measurement', partKey: '', fields: {} })
    setAddChangeOpen(true)
  }

  const partOptions = useMemo(() => {
    if (!activeSample) return []
    if (changeDraft.kind === 'measurement') {
      return (['第一轮', '第二轮', '第三轮'] as const).flatMap((round) =>
        activeSample.measurements[round].map((m) => ({
          key: `${round}:${m.key}`,
          label: `${round} · ${m.name}`,
          record: m as unknown as Record<string, unknown>,
        })),
      )
    }
    if (changeDraft.kind === 'annotation') {
      return activeSample.annotations.map((a) => ({ key: a.id, label: `${a.part}（${a.id}）`, record: a as unknown as Record<string, unknown> }))
    }
    return activeSample.proposals.map((p) => ({ key: p.id, label: `${p.affectedPart}（${p.id}）`, record: p as unknown as Record<string, unknown> }))
  }, [activeSample, changeDraft.kind])

  const selectedPart = partOptions.find((item) => item.key === changeDraft.partKey)

  const handleAddChange = () => {
    if (!activeBatch || !selectedPart) return
    const partName = changeDraft.kind === 'measurement'
      ? String((selectedPart.record as { name?: string }).name ?? selectedPart.label)
      : changeDraft.kind === 'annotation'
        ? String((selectedPart.record as { part?: string }).part ?? selectedPart.label)
        : String((selectedPart.record as { affectedPart?: string }).affectedPart ?? selectedPart.label)
    const round = changeDraft.kind === 'measurement' ? (changeDraft.partKey.split(':')[0] as OfflineChange['round']) : undefined
    const fields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changeDraft.fields)) {
      if (value !== undefined && value !== '') fields[key] = value
    }
    dispatch(addChange({ batchId: activeBatch.id, change: { kind: changeDraft.kind, partKey: changeDraft.partKey, partName, round, fields } }))
    setAddChangeOpen(false)
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">OFFLINE BATCH / 离线修订批次</Typography>
          <Typography component="h1" fontWeight={800}>断网合并，联网逐字段重算</Typography>
          <Typography color="text.secondary">离线时在本机合并尺寸实测、批注与替代方案；联网后按部位逐字段对比正式版本，冲突保留两份等待确认。</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="演示用：强制联网失败，验证批次原样保留与重试">
            <FormControlLabel
              control={<Switch checked={forceFail} onChange={(e) => setForceFail(e.target.checked)} size="small" />}
              label={<Typography fontSize={12}>模拟联网失败</Typography>}
            />
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>新建离线批次</Button>
        </Stack>
      </Box>

      {!activeSnapshot && activeBatch && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          该批次缺少锁定快照，提交时将以当前本机版本为基准创建快照。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '300px minmax(0,1fr)' }, gap: 1.5 }}>
        {/* 批次列表 */}
        <Box className="panel" sx={{ overflow: 'hidden', alignSelf: 'start' }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid #ece9e4' }}>
            <Typography fontWeight={800} fontSize={13}>批次列表（{batches.length}）</Typography>
          </Box>
          {batches.length === 0 && (
            <Box sx={{ p: 2 }}>
              <Typography color="text.secondary" fontSize={12}>暂无离线批次，点击右上角新建。</Typography>
            </Box>
          )}
          {batches.map((batch) => (
            <Button
              key={batch.id}
              onClick={() => dispatch(setActiveBatch(batch.id))}
              sx={{
                display: 'block',
                width: '100%',
                p: 1.5,
                borderRadius: 0,
                textAlign: 'left',
                textTransform: 'none',
                borderBottom: '1px solid #efede9',
                bgcolor: batch.id === activeBatch?.id ? '#edf4f1' : 'transparent',
                boxShadow: batch.id === activeBatch?.id ? 'inset 3px 0 #2d7b72' : 'none',
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800} fontSize={13}>{batch.id}</Typography>
                <Chip size="small" label={batch.status} color={statusColor[batch.status]} sx={{ height: 20, fontSize: 10 }} />
              </Stack>
              <Typography fontSize={12} mt={0.3}>{batch.sampleCode} · {batch.sampleName}</Typography>
              <Typography color="text.secondary" fontSize={11} mt={0.3}>{batch.changes.length} 项离线变更 · {batch.updatedAt}</Typography>
              {pendingForBatch(batch.id).length > 0 && (
                <Chip size="small" label={`${pendingForBatch(batch.id).length} 项待审修订`} color="secondary" sx={{ mt: 0.6, height: 18, fontSize: 10 }} />
              )}
            </Button>
          ))}
        </Box>

        {/* 批次详情 */}
        {activeBatch ? (
          <Box className="panel">
            <Box sx={{ p: 2, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={800} fontSize={16}>{activeBatch.id}</Typography>
                  <Chip size="small" label={activeBatch.status} color={statusColor[activeBatch.status]} />
                  <SourceChip source="offline-batch" />
                </Stack>
                <Typography color="text.secondary" fontSize={12} mt={0.5}>{activeBatch.sampleCode} · {activeBatch.sampleName}</Typography>
                <Typography fontSize={12} mt={0.3}>{activeBatch.note}</Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {activeBatch.status === '草稿' && (
                  <Button size="small" startIcon={<AddIcon />} onClick={openAddChange}>添加变更</Button>
                )}
                {(activeBatch.status === '待合并' || activeBatch.status === '合并失败') && (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={activeBatch.status === '合并失败' ? <RefreshIcon /> : <CloudSyncIcon />}
                    disabled={isFetching || activeBatch.changes.length === 0}
                    onClick={() => runMerge(activeBatch, activeBatch.status === '合并失败')}
                  >
                    {activeBatch.status === '合并失败' ? '重试合并' : '联网合并'}
                  </Button>
                )}
                <Tooltip title="删除批次">
                  <IconButton size="small" onClick={() => dispatch(deleteBatch(activeBatch.id))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Stack>
            </Box>

            {activeBatch.status === '合并失败' && (
              <Alert severity="error" sx={{ m: 1.5 }} action={
                <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={() => runMerge(activeBatch, true)}>重试</Button>
              }>
                合并失败：{activeBatch.failureReason}。批次已原样保留，变更未丢失，可随时重试。
              </Alert>
            )}

            {activeBatch.status === '待确认' && (
              <Alert severity="warning" sx={{ m: 1.5 }}>
                同一部位两边都做了修改，已保留两份副本等待确认。确认前不会覆盖锁定快照。
              </Alert>
            )}

            {/* 离线变更列表 */}
            <Box sx={{ p: 2 }}>
              <Typography fontWeight={800} fontSize={13} mb={1}>离线变更（{activeBatch.changes.length}）</Typography>
              {activeBatch.changes.length === 0 && (
                <Typography color="text.secondary" fontSize={12}>暂无变更，点击"添加变更"录入尺寸实测、批注或替代方案。</Typography>
              )}
              <Stack spacing={0.8}>
                {activeBatch.changes.map((change) => (
                  <Box key={change.id} sx={{ p: 1.2, border: '1px solid #e2dfda', borderRadius: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={change.kind === 'measurement' ? '尺寸实测' : change.kind === 'annotation' ? '批注' : '替代方案'} sx={{ height: 18, fontSize: 10 }} />
                        <Typography fontWeight={700} fontSize={12}>{change.partName}</Typography>
                        {change.round && <Typography color="text.secondary" fontSize={11}>{change.round}</Typography>}
                      </Stack>
                      <Typography fontSize={12} mt={0.3} color="text.secondary">
                        {Object.entries(change.fields).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                      </Typography>
                    </Box>
                    {activeBatch.status === '草稿' && (
                      <IconButton size="small" onClick={() => dispatch(removeChange({ batchId: activeBatch.id, changeId: change.id }))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>

            <Divider />

            {/* 合并结果：逐部位字段级 */}
            {activeBatch.mergeResults && activeBatch.mergeResults.length > 0 && (
              <Box sx={{ p: 2 }}>
                <Typography fontWeight={800} fontSize={13} mb={1}>逐部位字段级合并结果</Typography>
                <Stack spacing={1.2}>
                  {activeBatch.mergeResults.map((result) => (
                    <MergeResultCard
                      key={result.partKey}
                      result={result}
                      batchId={activeBatch.id}
                      locked={activeBatch.status === '合并成功'}
                      onResolve={(side) => dispatch(resolveConflict({ batchId: activeBatch.id, partKey: result.partKey, side }))}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {/* 待审修订 */}
            {pendingForBatch(activeBatch.id).length > 0 && (
              <>
                <Divider />
                <Box sx={{ p: 2 }}>
                  <Typography fontWeight={800} fontSize={13} mb={1}>待审修订（{pendingForBatch(activeBatch.id).length}）</Typography>
                  <Typography color="text.secondary" fontSize={11} mb={1}>锁定版本合并后不覆盖原记录，单独进入待审队列。</Typography>
                  <Stack spacing={0.8}>
                    {pendingForBatch(activeBatch.id).map((rev) => (
                      <Box key={rev.id} sx={{ p: 1.2, border: '1px solid #e2dfda', borderRadius: 1, bgcolor: '#faf8f5' }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography fontWeight={700} fontSize={12}>{rev.partName}</Typography>
                          <SourceChip source={rev.source} />
                          <Chip size="small" label={rev.status} color={rev.status === '已确认' ? 'success' : rev.status === '已驳回' ? 'default' : 'warning'} sx={{ height: 18, fontSize: 10 }} />
                        </Stack>
                        <Typography fontSize={12} mt={0.3} color="text.secondary">{rev.summary}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </>
            )}
          </Box>
        ) : (
          <Box className="panel" sx={{ p: 3 }}>
            <Typography color="text.secondary">选择或新建一个离线批次。</Typography>
          </Box>
        )}
      </Box>

      {/* 新建批次 */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建离线修订批次</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField select size="small" fullWidth label="选择款式档案" value={newBatch.sampleId} onChange={(e) => setNewBatch({ ...newBatch, sampleId: e.target.value })}>
              {samples.map((sample) => (
                <MenuItem key={sample.id} value={sample.id}>{sample.styleCode} · {sample.styleName}</MenuItem>
              ))}
            </TextField>
            <TextField multiline minRows={2} fullWidth label="批次说明" value={newBatch.note} onChange={(e) => setNewBatch({ ...newBatch, note: e.target.value })} placeholder="例如：工厂离线评审，更新胸围实测与肩线方案。" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" disabled={!newBatch.sampleId} onClick={handleCreate}>创建批次</Button>
        </DialogActions>
      </Dialog>

      {/* 添加变更 */}
      <Dialog open={addChangeOpen} onClose={() => setAddChangeOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加离线变更</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <FormControl size="small" fullWidth>
              <InputLabel>变更类型</InputLabel>
              <Select label="变更类型" value={changeDraft.kind} onChange={(e) => { setChangeDraft({ kind: e.target.value as OfflineChange['kind'], partKey: '', fields: {} }) }}>
                <MenuItem value="measurement">尺寸实测</MenuItem>
                <MenuItem value="annotation">批注</MenuItem>
                <MenuItem value="proposal">替代方案</MenuItem>
              </Select>
            </FormControl>
            <TextField select size="small" fullWidth label="选择部位" value={changeDraft.partKey} onChange={(e) => setChangeDraft({ ...changeDraft, partKey: e.target.value, fields: {} })}>
              {partOptions.map((item) => (
                <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>
              ))}
            </TextField>
            {selectedPart && (
              <Stack spacing={1}>
                {fieldDefsForKind(changeDraft.kind).map(({ field, label }) => {
                  const current = (selectedPart.record as Record<string, unknown>)[field]
                  const isStatus = field === 'status'
                  if (isStatus) {
                    const options = changeDraft.kind === 'measurement' ? [] : changeDraft.kind === 'annotation' ? ['待处理', '已解决'] : ['待决定', '已采纳', '未采纳']
                    return (
                      <TextField
                        key={field}
                        select
                        size="small"
                        fullWidth
                        label={`${label}（当前 ${String(current)}）`}
                        value={String(changeDraft.fields[field] ?? current)}
                        onChange={(e) => setChangeDraft({ ...changeDraft, fields: { ...changeDraft.fields, [field]: e.target.value } })}
                      >
                        {options.map((opt) => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                      </TextField>
                    )
                  }
                  return (
                    <TextField
                      key={field}
                      size="small"
                      fullWidth
                      label={`${label}（当前 ${String(current)}）`}
                      value={changeDraft.fields[field] ?? ''}
                      onChange={(e) => {
                        const val = changeDraft.kind === 'measurement' && field !== 'name' && field !== 'key' ? Number(e.target.value) : e.target.value
                        setChangeDraft({ ...changeDraft, fields: { ...changeDraft.fields, [field]: val } })
                      }}
                    />
                  )
                })}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddChangeOpen(false)}>取消</Button>
          <Button variant="contained" disabled={!changeDraft.partKey || Object.keys(changeDraft.fields).length === 0} onClick={handleAddChange}>添加变更</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function MergeResultCard({ result, batchId, locked, onResolve }: {
  result: MergePartResult
  batchId: string
  locked: boolean
  onResolve: (side: 'local' | 'official' | 'both') => void
}) {
  const [expanded, setExpanded] = useState(result.status === 'conflict')
  const changedFields = result.fields.filter((f) => f.changedBy !== 'none')

  return (
    <Box sx={{ border: `1px solid ${result.status === 'conflict' ? '#d47b3d' : '#e2dfda'}`, borderRadius: 1.2, overflow: 'hidden' }}>
      <Box
        sx={{ p: 1.2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', bgcolor: result.status === 'conflict' ? '#fdf3ec' : '#faf8f5' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography fontWeight={800} fontSize={13}>{result.partName}</Typography>
          <Chip size="small" label={result.kind === 'measurement' ? '尺寸实测' : result.kind === 'annotation' ? '批注' : '替代方案'} sx={{ height: 18, fontSize: 10 }} />
          {result.status === 'conflict' ? (
            <Chip size="small" icon={<WarningAmberIcon />} label="冲突：两边都改" color="warning" sx={{ height: 20, fontSize: 10 }} />
          ) : (
            <Chip size="small" icon={<CheckCircleOutlineIcon />} label="干净合并" color="success" sx={{ height: 20, fontSize: 10 }} />
          )}
        </Stack>
        <Typography color="text.secondary" fontSize={11}>{expanded ? '收起' : '展开'}</Typography>
      </Box>

      {expanded && (
        <Box sx={{ p: 1.2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: 11 }}>字段</TableCell>
                <TableCell sx={{ fontSize: 11 }}>锁定快照</TableCell>
                <TableCell sx={{ fontSize: 11 }}>离线批次</TableCell>
                <TableCell sx={{ fontSize: 11 }}>正式版本</TableCell>
                <TableCell sx={{ fontSize: 11 }}>变更方</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {changedFields.map((field) => (
                <TableRow key={field.field}>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>{field.label}</TableCell>
                  <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{String(field.base)}</TableCell>
                  <TableCell sx={{ fontSize: 11, color: field.changedBy === 'local' || field.changedBy === 'both' ? '#b44b2d' : 'inherit', fontWeight: field.changedBy === 'both' ? 800 : 400 }}>
                    {String(field.local)}
                  </TableCell>
                  <TableCell sx={{ fontSize: 11, color: field.changedBy === 'official' || field.changedBy === 'both' ? '#b44b2d' : 'inherit', fontWeight: field.changedBy === 'both' ? 800 : 400 }}>
                    {String(field.official)}
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }}>
                    {field.changedBy === 'both' ? <Chip size="small" label="两边" color="warning" sx={{ height: 18, fontSize: 10 }} />
                      : field.changedBy === 'local' ? <Chip size="small" label="离线" color="secondary" sx={{ height: 18, fontSize: 10 }} />
                      : <Chip size="small" label="正式" variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {result.status === 'conflict' && !locked && (
            <Box sx={{ mt: 1.2, p: 1.2, bgcolor: '#fff8f2', borderRadius: 1 }}>
              <Typography fontSize={12} fontWeight={700} mb={0.8}>保留哪一方？确认前锁定快照不会被覆盖。</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button size="small" variant="outlined" color="secondary" onClick={() => onResolve('local')}>保留离线批次</Button>
                <Button size="small" variant="outlined" onClick={() => onResolve('official')}>保留正式版本</Button>
                <Button size="small" variant="contained" color="warning" onClick={() => onResolve('both')}>两边都保留</Button>
              </Stack>
              {result.confirmedSide && (
                <Chip size="small" label={`已确认：${sourceLabel[result.confirmedSide]}`} color="success" sx={{ mt: 0.8, height: 20, fontSize: 10 }} />
              )}
            </Box>
          )}
          {result.status === 'conflict' && locked && (
            <Chip size="small" label={`已确认：${result.confirmedSide ? sourceLabel[result.confirmedSide] : ''}`} color="success" sx={{ mt: 0.8, height: 20, fontSize: 10 }} />
          )}
        </Box>
      )}
    </Box>
  )
}
