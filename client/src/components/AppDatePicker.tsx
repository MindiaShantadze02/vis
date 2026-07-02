import { useState } from 'react'
import { DatePicker, type DatePickerProps } from '@mui/x-date-pickers/DatePicker'

/**
 * DatePicker wrapper that opens the calendar when the user clicks anywhere on
 * the field (not just the calendar icon) and disables manual keyboard entry of
 * the individual date sections. This keeps a single, consistent "click to pick"
 * behaviour across the app.
 */
export function AppDatePicker(props: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const { slotProps, ...rest } = props

  return (
    <DatePicker
      {...rest}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      slotProps={{
        ...slotProps,
        // Prevent typing year/month/day by hand.
        field: {
          ...(slotProps?.field as object),
          readOnly: true,
        },
        // Clicking the field itself opens the calendar.
        textField: {
          ...(slotProps?.textField as object),
          onClick: () => setOpen(true),
        },
      }}
    />
  )
}
