'use client'

import { Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { ImportDialog } from '@/components/admin/import-dialog'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client/api'
import type { ImportPreview } from '@/lib/server/transfer'

/**
 * PRD 2 §14.2 — *"drop a `.zip` anywhere on the dashboard, or use `[Import…]`."*
 *
 * Two routes to the same place, because a master who has just been handed a file on a USB stick will
 * try dropping it, and one who has it in a folder will look for a button. Both land on the same
 * inspect-then-decide flow, and **nothing is written until they choose** (protocol §8.3).
 *
 * The drop target is the whole dashboard rather than a bordered box: a dropzone the size of a card is
 * a thing to aim at, and the page has no other use for a dropped file.
 */
export function ImportZone({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin.import')

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<
    { file: File; preview: ImportPreview } | undefined
  >()
  const [problem, setProblem] = useState<string | undefined>()

  const inspect = async (file: File): Promise<void> => {
    setProblem(undefined)
    const result = await api.inspectImport(file)
    if (result.ok && result.data) {
      setPending({ file, preview: result.data.preview })
    } else if (!result.ok) {
      // A typed refusal, so the message is the specific one — a newer format, or a damaged zip.
      setProblem(result.message)
    }
  }

  return (
    <div
      // Drag events, not a form: the file never posts anywhere until the dialog says so.
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) void inspect(file)
      }}
      // `flex-col gap-10` mirrors the spacing the dashboard's other top-level sections use — this
      // now wraps more than one of them (§14.2's "anywhere on the dashboard"), and the drop
      // target growing must not visibly change the layout underneath it.
      className={`flex flex-col gap-10 ${dragging ? 'ring-primary rounded-xl ring-2' : ''}`}
    >
      <div className="flex items-center justify-between gap-4">
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" />
          {t('importButton')}
        </Button>
        {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        aria-label={t('importButton')}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void inspect(file)
          // Cleared so choosing the same file twice fires `change` again — otherwise a master who
          // cancels the dialog cannot reopen it without picking a different file first.
          event.target.value = ''
        }}
      />

      {children}

      {pending ? (
        <ImportDialog
          file={pending.file}
          preview={pending.preview}
          onClose={() => setPending(undefined)}
        />
      ) : null}
    </div>
  )
}
