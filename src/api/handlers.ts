import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type { Annotation, RevisionProposal } from './types'

let samples = structuredClone(seedSamples)

export const handlers = [
  http.get('/api/samples', () => HttpResponse.json(samples)),
  http.get('/api/samples/:id', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    return sample ? HttpResponse.json(sample) : new HttpResponse(null, { status: 404 })
  }),
  http.post('/api/samples/:id/annotations', async ({ params, request }) => {
    const body = (await request.json()) as { x: number; y: number; part: string; content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.annotations.push({ id: `AN-${Date.now()}`, author: '当前用户', status: '待处理', ...body })
    return HttpResponse.json(sample, { status: 201 })
  }),
  http.post('/api/samples/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.comments.push({ id: `CM-${Date.now()}`, author: '当前用户', content: body.content, date: '刚刚' })
    return HttpResponse.json(sample, { status: 201 })
  }),
  // 演示工具：模拟他人在正式版本上的改动（尺寸 + 批注 + 方案状态）
  http.post('/api/samples/:id/remote-edit', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const chest = sample.measurements['第三轮'].find((item) => item.key === 'chest')
    if (chest) chest.actual = Number((chest.actual + 0.9).toFixed(1))
    const sleeve = sample.measurements['第三轮'].find((item) => item.key === 'sleeve')
    if (sleeve) sleeve.actual = Number((sleeve.actual - 0.6).toFixed(1))
    sample.annotations.push({
      id: `AN-R-${String(Date.now()).slice(-6)}`,
      x: 58,
      y: 36,
      part: '袖口',
      content: '正式版本：袖口扣位下移 0.5cm，已电话与供应商确认。',
      author: '陈曼 / 产品',
      status: '待处理',
      origin: '正式版本',
    })
    const pending = sample.proposals.find((item) => item.status === '待决定')
    if (pending) pending.status = '已采纳'
    return HttpResponse.json(sample)
  }),
  // 离线批次合并结果写回正式版本；锁定版本拒绝写入（只能进入待审修订）
  http.post('/api/samples/:id/apply-merge', async ({ params, request }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    if (sample.status === '已锁定') {
      return HttpResponse.json({ message: '正式版本已锁定，合并结果只能进入待审修订' }, { status: 409 })
    }
    const body = (await request.json()) as {
      measurements: Record<string, number>
      annotations: Annotation[]
      proposals: RevisionProposal[]
    }
    sample.measurements['第三轮'].forEach((item) => {
      const next = body.measurements[item.key]
      if (typeof next === 'number') item.actual = next
    })
    sample.annotations = body.annotations
    sample.proposals = body.proposals
    return HttpResponse.json(sample)
  }),
]
