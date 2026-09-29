import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Annotation, Sample } from '../api/types'

export type OfficialSample = Sample & {
  version: number
  source: 'official'
  lastModified: string
}

export const samplingApi = createApi({
  reducerPath: 'samplingApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Sample', 'Samples', 'OfficialSample'],
  endpoints: (builder) => ({
    getSamples: builder.query<Sample[], void>({
      query: () => 'api/samples',
      providesTags: ['Samples'],
    }),
    getSample: builder.query<Sample, string>({
      query: (id) => `api/samples/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Sample', id }],
    }),
    getOfficialVersion: builder.query<OfficialSample, string>({
      query: (id) => `api/samples/${id}/official`,
      providesTags: (_result, _error, id) => [{ type: 'OfficialSample', id }],
    }),
    addAnnotation: builder.mutation<Sample, { sampleId: string; annotation: Omit<Annotation, 'id' | 'author' | 'status'> }>({
      query: ({ sampleId, annotation }) => ({
        url: `api/samples/${sampleId}/annotations`,
        method: 'POST',
        body: annotation,
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }],
    }),
    addComment: builder.mutation<Sample, { sampleId: string; content: string }>({
      query: ({ sampleId, content }) => ({
        url: `api/samples/${sampleId}/comments`,
        method: 'POST',
        body: { content },
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }],
    }),
  }),
})

export const {
  useGetSamplesQuery,
  useGetSampleQuery,
  useGetOfficialVersionQuery,
  useLazyGetOfficialVersionQuery,
  useAddAnnotationMutation,
  useAddCommentMutation,
} = samplingApi
