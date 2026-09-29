import { Chip } from '@mui/material'
import type { ChangeSource } from '../api/types'

/** 标清记录来源：正式版本或离线批次 */
export function SourceChip({ source, size = 'small' }: { source: ChangeSource; size?: 'small' | 'medium' }) {
  return (
    <Chip
      size={size}
      label={source === 'official' ? '正式版本' : '离线批次'}
      color={source === 'official' ? 'default' : 'secondary'}
      variant={source === 'official' ? 'outlined' : 'filled'}
      sx={{ height: size === 'small' ? 20 : 24, fontSize: size === 'small' ? 10 : 12 }}
    />
  )
}
