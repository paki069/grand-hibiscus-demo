import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

export function receiptFileError(file: File) {
  if (file.size > 5 * 1024 * 1024) return 'File is too large (max 5 MB).'
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) {
    return 'Please upload a JPG, PNG, WebP image or PDF.'
  }
  return null
}

export async function uploadReceiptFile(file: File, reservationId: string, paymentId: string, userId: string) {
  const validationError = receiptFileError(file)
  if (validationError) return validationError

  const extension = file.type === 'application/pdf'
    ? 'pdf'
    : file.type === 'image/jpeg'
      ? 'jpg'
      : file.type.split('/')[1]
  const path = `${userId}/${reservationId}/${Date.now()}.${extension}`
  const supabase = createClient()
  const upload = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type })
  if (upload.error) return `Upload failed: ${upload.error.message}`

  const { error } = await supabase.rpc('attach_receipt', {
    p_res: reservationId,
    p_path: path,
    p_payment: paymentId,
  })
  if (error) return friendlyError(error)
  return null
}
