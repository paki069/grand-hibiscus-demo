'use client'

import { useEffect, useRef, useState } from 'react'
import RestaurantMenu, { type ProductVM } from '@/components/RestaurantMenu'

export default function DiningMenuModal({
  products,
  currency,
}: {
  products: ProductVM[]
  currency: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        className="home-inline-link dining-menu-trigger"
        aria-haspopup="dialog"
        aria-controls="dining-menu-dialog"
        onClick={() => setIsOpen(true)}
      >
        View our menu <span aria-hidden="true">↗</span>
      </button>
      <dialog
        ref={dialogRef}
        id="dining-menu-dialog"
        className="dining-menu-dialog"
        aria-labelledby="dining-menu-dialog-title"
        onCancel={(event) => {
          event.preventDefault()
          dialogRef.current?.close()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            dialogRef.current?.close()
          }
        }}
        onClose={() => setIsOpen(false)}
      >
        <div className="dining-menu-dialog-top">
          <header className="dining-menu-dialog-header">
            <h2 id="dining-menu-dialog-title">Restaurant menu</h2>
            <button className="dining-menu-dialog-close" type="button" aria-label="Close menu" onClick={() => dialogRef.current?.close()}>
              ×
            </button>
          </header>
        </div>
        <RestaurantMenu products={products} currency={currency} showHeading={false} />
      </dialog>
    </>
  )
}
