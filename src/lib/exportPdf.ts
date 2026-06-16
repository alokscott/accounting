import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { DepositWithClient, WithdrawalWithClient } from './supabase'
import { ClosedPosition } from '@/components/ClosedPositionsTable'
import {
  calculateCurrentValue,
  getCompleteWeeks,
  getFirstWeekStart,
  formatCurrency,
  formatDate,
  getDayOfWeek,
  parseDate,
} from './interest'

/**
 * Fetch the brand logo and rasterize it to a PNG data URL so jsPDF can embed
 * it. We render at 4× the displayed pixel size so the logo stays crisp in the
 * PDF. Returns null if the asset can't be fetched (caller falls back to text).
 */
async function loadBrandLogoPng(displayWidthMm: number, displayHeightMm: number): Promise<string | null> {
  try {
    const res = await fetch('/inessa-logo.svg')
    if (!res.ok) return null
    const svgText = await res.text()
    const blob = new Blob([svgText], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    try {
      return await new Promise<string>((resolve, reject) => {
        const img = new Image()
        const scale = 4 // px per PDF mm (rough); higher = sharper
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(displayWidthMm * scale)
          canvas.height = Math.round(displayHeightMm * scale)
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('No canvas context')); return }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('Failed to load SVG'))
        img.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

type ColStyles = {
  [key: number]: {
    cellWidth?: number
    halign?: 'left' | 'right' | 'center'
    textColor?: [number, number, number]
    fontStyle?: 'bold'
    fontSize?: number
  }
}

export async function exportToPdf(deposits: DepositWithClient[], closedPositions: ClosedPosition[] = [], rangeLabel?: string, showCompany = false) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  // Colors
  const primaryColor: [number, number, number] = [34, 197, 94] // Green accent
  const darkColor: [number, number, number] = [15, 23, 42]
  const grayColor: [number, number, number] = [100, 116, 139]

  // Header
  doc.setFillColor(...darkColor)
  doc.rect(0, 0, pageWidth, 45, 'F')

  // Brand logo (falls back to text title if the asset can't be loaded).
  const logoPng = await loadBrandLogoPng(50, 11)
  if (logoPng) {
    doc.addImage(logoPng, 'PNG', 20, 13, 50, 11)
  } else {
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.text('Inessa Holdings', 20, 25)
  }

  // Subtitle
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 200, 200)
  doc.text('Fund Deployment Summary Report', 20, 35)

  // Date
  doc.setFontSize(10)
  doc.setTextColor(200, 200, 200)
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  doc.text(`Generated: ${currentDate}`, pageWidth - 20, 35, { align: 'right' })

  // Optional reporting period (date range used for the export)
  if (rangeLabel) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...grayColor)
    doc.text(`Reporting period: ${rangeLabel}`, 20, 54)
  }

  // Calculate totals. current_value is read from the DB column; fall back to a
  // live compute only for rows without a stored value.
  const totals = deposits.reduce(
    (acc, deposit) => {
      const depositDate = parseDate(deposit.deposit_date)
      const principal = Number(deposit.amount)
      const currentValue = deposit.current_value != null
        ? Number(deposit.current_value)
        : calculateCurrentValue(principal, depositDate)
      const interest = deposit.interest_accrued != null
        ? Number(deposit.interest_accrued)
        : Math.max(0, currentValue - principal)

      return {
        principal: acc.principal + principal,
        currentValue: acc.currentValue + currentValue,
        interest: acc.interest + interest,
      }
    },
    { principal: 0, currentValue: 0, interest: 0 }
  )

  // Summary Cards
  let yPos = 60

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text('Active Portfolio Summary', 20, yPos)

  yPos += 10

  // Summary boxes
  const boxWidth = (pageWidth - 60) / 3
  const boxHeight = 30
  const boxY = yPos

  // Box 1 - Total Deposited
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(20, boxY, boxWidth, boxHeight, 3, 3, 'F')
  doc.setFontSize(8)
  doc.setTextColor(...grayColor)
  doc.text('Total Deposited', 25, boxY + 10)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text(formatCurrency(totals.principal), 25, boxY + 22)

  // Box 2 - Current Value
  doc.setFillColor(240, 253, 244)
  doc.roundedRect(30 + boxWidth, boxY, boxWidth, boxHeight, 3, 3, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Current Value', 35 + boxWidth, boxY + 10)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...primaryColor)
  doc.text(formatCurrency(totals.currentValue), 35 + boxWidth, boxY + 22)

  // Box 3 - Total Interest
  doc.setFillColor(240, 253, 244)
  doc.roundedRect(40 + boxWidth * 2, boxY, boxWidth, boxHeight, 3, 3, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Total Interest Earned', 45 + boxWidth * 2, boxY + 10)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...primaryColor)
  doc.text(`+${formatCurrency(totals.interest)}`, 45 + boxWidth * 2, boxY + 22)

  yPos = boxY + boxHeight + 20

  // Deposits Table
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text('Active Deposit Details', 20, yPos)

  yPos += 5

  // Prepare table data
  const tableData = deposits.map((deposit) => {
    const depositDate = parseDate(deposit.deposit_date)
    const principalAmt = Number(deposit.amount)
    const currentValue = deposit.current_value != null
      ? Number(deposit.current_value)
      : calculateCurrentValue(principalAmt, depositDate)
    const interest = deposit.interest_accrued != null
      ? Number(deposit.interest_accrued)
      : Math.max(0, currentValue - principalAmt)
    const weeks = getCompleteWeeks(depositDate)
    const firstWeekStart = getFirstWeekStart(depositDate)

    const row = [
      formatDate(depositDate),
      getDayOfWeek(depositDate),
      formatCurrency(deposit.amount),
      formatDate(firstWeekStart),
      `${weeks} week${weeks !== 1 ? 's' : ''}`,
      `+${formatCurrency(interest)}`,
      formatCurrency(currentValue),
    ]
    return showCompany ? [deposit.clients?.name ?? '—', ...row] : row
  })

  const depositHead = showCompany
    ? ['Company', 'Deposit Date', 'Day', 'Principal', 'Week 1 Starts', 'Weeks', 'Interest', 'Current Value']
    : ['Deposit Date', 'Day', 'Principal', 'Week 1 Starts', 'Weeks', 'Interest', 'Current Value']

  const depositColumnStyles: ColStyles = showCompany
    ? {
        0: { cellWidth: 24 },
        1: { cellWidth: 22 },
        2: { cellWidth: 16 },
        3: { halign: 'right', cellWidth: 24 },
        4: { cellWidth: 22 },
        5: { halign: 'center', cellWidth: 14 },
        6: { halign: 'right', cellWidth: 24, textColor: primaryColor },
        7: { halign: 'right', cellWidth: 24, fontStyle: 'bold' },
      }
    : {
        0: { cellWidth: 25 },
        1: { cellWidth: 22 },
        2: { halign: 'right', cellWidth: 28 },
        3: { cellWidth: 25 },
        4: { halign: 'center', cellWidth: 18 },
        5: { halign: 'right', cellWidth: 25, textColor: primaryColor },
        6: { halign: 'right', cellWidth: 28, fontStyle: 'bold' },
      }

  autoTable(doc, {
    startY: yPos,
    head: [depositHead],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: darkColor,
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'left',
    },
    bodyStyles: {
      fontSize: showCompany ? 7 : 8,
      textColor: darkColor,
    },
    columnStyles: depositColumnStyles,
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 20, right: 20 },
  })

  let finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // Closed Positions Section
  if (closedPositions.length > 0) {
    const closedTotals = closedPositions.reduce(
      (acc, pos) => ({
        principal: acc.principal + pos.principal,
        interest: acc.interest + pos.interestRedeemed,
        payout: acc.payout + pos.totalPayout,
      }),
      { principal: 0, interest: 0, payout: 0 }
    )

    yPos = finalY + 20

    // Check if we need a new page
    if (yPos > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage()
      yPos = 20
    }

    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...darkColor)
    doc.text('Closed Positions', 20, yPos)

    yPos += 10

    // Summary boxes for closed positions
    const cBoxY = yPos

    doc.setFillColor(248, 250, 252)
    doc.roundedRect(20, cBoxY, boxWidth, boxHeight, 3, 3, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...grayColor)
    doc.text('Principal Returned', 25, cBoxY + 10)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...darkColor)
    doc.text(formatCurrency(closedTotals.principal), 25, cBoxY + 22)

    doc.setFillColor(240, 253, 244)
    doc.roundedRect(30 + boxWidth, cBoxY, boxWidth, boxHeight, 3, 3, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...grayColor)
    doc.text('Interest Redeemed', 35 + boxWidth, cBoxY + 10)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...primaryColor)
    doc.text(`+${formatCurrency(closedTotals.interest)}`, 35 + boxWidth, cBoxY + 22)

    doc.setFillColor(240, 253, 244)
    doc.roundedRect(40 + boxWidth * 2, cBoxY, boxWidth, boxHeight, 3, 3, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...grayColor)
    doc.text('Total Payouts', 45 + boxWidth * 2, cBoxY + 10)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...darkColor)
    doc.text(formatCurrency(closedTotals.payout), 45 + boxWidth * 2, cBoxY + 22)

    yPos = cBoxY + boxHeight + 10

    const closedTableData = closedPositions.map((pos) => [
      formatDate(pos.depositDate + 'T00:00:00'),
      formatDate(pos.closureDate + 'T00:00:00'),
      formatCurrency(pos.principal),
      `${pos.weeksElapsed} week${pos.weeksElapsed !== 1 ? 's' : ''}`,
      `+${formatCurrency(pos.interestRedeemed)}`,
      formatCurrency(pos.totalPayout),
    ])

    autoTable(doc, {
      startY: yPos,
      head: [['Deposit Date', 'Closure Date', 'Principal', 'Weeks', 'Interest Redeemed', 'Total Payout']],
      body: closedTableData,
      theme: 'grid',
      headStyles: {
        fillColor: darkColor,
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: {
        fontSize: 8,
        textColor: darkColor,
      },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 28 },
        2: { halign: 'right', cellWidth: 28 },
        3: { halign: 'center', cellWidth: 22 },
        4: { halign: 'right', cellWidth: 30, textColor: primaryColor },
        5: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      margin: { left: 20, right: 20 },
    })

    finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  }

  // Footer
  finalY += 15

  doc.setDrawColor(200, 200, 200)
  doc.line(20, finalY, pageWidth - 20, finalY)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Interest Rate: 0.5% compound per complete week (Monday-Sunday)', 20, finalY + 8)
  doc.text('Week 1 starts from the coming Monday after deposit date', 20, finalY + 14)

  // Page number
  doc.text(`Page 1 of 1`, pageWidth - 20, finalY + 8, { align: 'right' })

  // Save the PDF
  const fileName = `Inessa_Holdings_Summary_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(fileName)
}

/** Withdrawals statement PDF (used by the dashboard's Withdrawals tab export). */
export async function exportWithdrawalsToPdf(withdrawals: WithdrawalWithClient[], rangeLabel?: string, showCompany = false) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  const primaryColor: [number, number, number] = [34, 197, 94]
  const darkColor: [number, number, number] = [15, 23, 42]
  const grayColor: [number, number, number] = [100, 116, 139]

  // Header
  doc.setFillColor(...darkColor)
  doc.rect(0, 0, pageWidth, 45, 'F')

  // Brand logo (falls back to text title if the asset can't be loaded).
  const logoPng = await loadBrandLogoPng(50, 11)
  if (logoPng) {
    doc.addImage(logoPng, 'PNG', 20, 13, 50, 11)
  } else {
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.text('Inessa Holdings', 20, 25)
  }
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 200, 200)
  doc.text('Withdrawals Statement', 20, 35)
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  doc.text(`Generated: ${currentDate}`, pageWidth - 20, 35, { align: 'right' })

  if (rangeLabel) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...grayColor)
    doc.text(`Reporting period: ${rangeLabel}`, 20, 54)
  }

  // Totals exclude rejected requests (their principal was released).
  const totals = withdrawals.reduce(
    (acc, w) => {
      if (w.status === 'rejected') return acc
      return {
        principal: acc.principal + Number(w.amount),
        interest: acc.interest + Number(w.interest_paid),
        payout: acc.payout + Number(w.total_payout),
      }
    },
    { principal: 0, interest: 0, payout: 0 }
  )

  let yPos = 60
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text('Withdrawals Summary', 20, yPos)
  yPos += 10

  const boxWidth = (pageWidth - 60) / 3
  const boxHeight = 30
  const boxY = yPos

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(20, boxY, boxWidth, boxHeight, 3, 3, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Principal Withdrawn', 25, boxY + 10)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text(formatCurrency(totals.principal), 25, boxY + 22)

  doc.setFillColor(240, 253, 244)
  doc.roundedRect(30 + boxWidth, boxY, boxWidth, boxHeight, 3, 3, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Interest Paid', 35 + boxWidth, boxY + 10)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...primaryColor)
  doc.text(`+${formatCurrency(totals.interest)}`, 35 + boxWidth, boxY + 22)

  doc.setFillColor(240, 253, 244)
  doc.roundedRect(40 + boxWidth * 2, boxY, boxWidth, boxHeight, 3, 3, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Total Payouts', 45 + boxWidth * 2, boxY + 10)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text(formatCurrency(totals.payout), 45 + boxWidth * 2, boxY + 22)

  yPos = boxY + boxHeight + 20
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text('Withdrawal Details', 20, yPos)
  yPos += 5

  const tableData = withdrawals.map((w) => {
    const row = [
      formatDate(w.withdrawal_date),
      formatCurrency(Number(w.amount)),
      `+${formatCurrency(Number(w.interest_paid))}`,
      formatCurrency(Number(w.total_payout)),
      w.status.charAt(0).toUpperCase() + w.status.slice(1),
      w.tx_hash ?? '—',
    ]
    return showCompany ? [w.clients?.name ?? '—', ...row] : row
  })

  const withdrawalHead = showCompany
    ? ['Company', 'Date', 'Principal', 'Interest', 'Total Payout', 'Status', 'Transaction']
    : ['Date', 'Principal', 'Interest', 'Total Payout', 'Status', 'Transaction']

  const withdrawalColumnStyles: ColStyles = showCompany
    ? {
        0: { cellWidth: 24 },
        1: { cellWidth: 20 },
        2: { halign: 'right', cellWidth: 22 },
        3: { halign: 'right', cellWidth: 20, textColor: primaryColor },
        4: { halign: 'right', cellWidth: 22, fontStyle: 'bold' },
        5: { cellWidth: 18 },
        6: { cellWidth: 44, fontSize: 6 },
      }
    : {
        0: { cellWidth: 24 },
        1: { halign: 'right', cellWidth: 26 },
        2: { halign: 'right', cellWidth: 24, textColor: primaryColor },
        3: { halign: 'right', cellWidth: 26, fontStyle: 'bold' },
        4: { cellWidth: 20 },
        5: { cellWidth: 50, fontSize: 6 },
      }

  autoTable(doc, {
    startY: yPos,
    head: [withdrawalHead],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: darkColor,
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'left',
    },
    bodyStyles: { fontSize: 7, textColor: darkColor },
    columnStyles: withdrawalColumnStyles,
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 20, right: 20 },
  })

  let finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  finalY += 15
  doc.setDrawColor(200, 200, 200)
  doc.line(20, finalY, pageWidth - 20, finalY)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Approved withdrawals include the on-chain transaction hash.', 20, finalY + 8)
  doc.text('Page 1 of 1', pageWidth - 20, finalY + 8, { align: 'right' })

  const fileName = `Inessa_Holdings_Withdrawals_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(fileName)
}

/**
 * Portfolio Overview PDF: KPI summary + deposits + withdrawals in a single
 * file. Called from the user dashboard's Overview-tab export.
 *
 * `deposits` should already carry REMAINING principal as `amount` (the caller
 * applies the withdrawn-by-deposit map before passing them in).
 */
export async function exportOverviewToPdf(
  deposits: DepositWithClient[],
  withdrawals: WithdrawalWithClient[],
  showCompany = false
) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  const primaryColor: [number, number, number] = [34, 197, 94]
  const darkColor: [number, number, number] = [15, 23, 42]
  const grayColor: [number, number, number] = [100, 116, 139]

  // Header
  doc.setFillColor(...darkColor)
  doc.rect(0, 0, pageWidth, 45, 'F')

  const logoPng = await loadBrandLogoPng(50, 11)
  if (logoPng) {
    doc.addImage(logoPng, 'PNG', 20, 13, 50, 11)
  } else {
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.text('Inessa Holdings', 20, 25)
  }
  doc.setTextColor(200, 200, 200)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Portfolio Overview', 20, 35)
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  doc.text(`Generated: ${currentDate}`, pageWidth - 20, 35, { align: 'right' })

  // ---- Compute summary totals (current_value from DB, fallback to live) ----
  const depositTotals = deposits.reduce(
    (acc, d) => {
      const depositDate = parseDate(d.deposit_date)
      const principal = Number(d.amount)
      const cv = d.current_value != null
        ? Number(d.current_value)
        : calculateCurrentValue(principal, depositDate)
      const interest = d.interest_accrued != null
        ? Number(d.interest_accrued)
        : Math.max(0, cv - principal)
      return {
        principal: acc.principal + principal,
        currentValue: acc.currentValue + cv,
        interest: acc.interest + interest,
      }
    },
    { principal: 0, currentValue: 0, interest: 0 }
  )
  const withdrawalTotals = withdrawals.reduce(
    (acc, w) => {
      if (w.status === 'rejected') return acc
      return {
        principal: acc.principal + Number(w.amount),
        payout: acc.payout + Number(w.total_payout),
        interest: acc.interest + Number(w.interest_paid),
      }
    },
    { principal: 0, payout: 0, interest: 0 }
  )
  const pendingCount = withdrawals.filter((w) => w.status === 'pending').length

  // ---- Overview KPI cards (2 rows × 3) ----
  let yPos = 60
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text('Portfolio Summary', 20, yPos)
  yPos += 10

  const boxWidth = (pageWidth - 60) / 3
  const boxHeight = 26
  const cards: Array<Array<{ label: string; value: string; accent?: boolean; hint?: string }>> = [
    [
      { label: 'Total Principal', value: formatCurrency(depositTotals.principal) },
      { label: 'Current Value', value: formatCurrency(depositTotals.currentValue), accent: true },
      { label: 'Interest Accrued', value: `+${formatCurrency(depositTotals.interest)}`, accent: true },
    ],
    [
      { label: 'Active Positions', value: String(deposits.length) },
      {
        label: 'Total Withdrawn',
        value: formatCurrency(withdrawalTotals.principal),
        hint: pendingCount ? `${pendingCount} pending` : undefined,
      },
      { label: 'Total Payouts', value: formatCurrency(withdrawalTotals.payout) },
    ],
  ]

  for (const row of cards) {
    for (let i = 0; i < row.length; i++) {
      const card = row[i]
      const x = 20 + i * (boxWidth + 5)
      doc.setFillColor(card.accent ? 240 : 248, card.accent ? 253 : 250, card.accent ? 244 : 252)
      doc.roundedRect(x, yPos, boxWidth, boxHeight, 3, 3, 'F')
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...grayColor)
      doc.text(card.label, x + 5, yPos + 8)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...(card.accent ? primaryColor : darkColor))
      doc.text(card.value, x + 5, yPos + 18)
      if (card.hint) {
        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...grayColor)
        doc.text(card.hint, x + 5, yPos + 23)
      }
    }
    yPos += boxHeight + 5
  }

  // ---- Account Statement: deposits + withdrawals interleaved by time ----
  // Bank-statement style — every deposit and withdrawal appears as a single
  // row, ordered by the transaction DATE shown in the Date column (newest
  // first), so the visible sequence reads chronologically. created_at only
  // breaks ties between same-date entries.
  yPos += 8
  if (yPos > pageHeight - 50) { doc.addPage(); yPos = 20 }

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkColor)
  doc.text('Account Statement', 20, yPos)
  yPos += 5

  const redColor: [number, number, number] = [220, 38, 38]

  type StatementEntry = {
    /** Transaction date (YYYY-MM-DD) — the value shown in the Date column. */
    dateKey: string
    /** created_at — only used to break ties between same-date entries. */
    tieKey: string
    row: string[]
    type: 'Deposit' | 'Withdrawal'
  }

  // Prefix the company name as the first cell when exporting the all-companies
  // (admin) view, so each row is attributable.
  const withCompany = (name: string | undefined, cells: string[]) =>
    showCompany ? [name ?? '—', ...cells] : cells

  const depositEntries: StatementEntry[] = deposits.map((d) => {
    const date = parseDate(d.deposit_date)
    const principalAmt = Number(d.amount)
    const cv = d.current_value != null
      ? Number(d.current_value)
      : calculateCurrentValue(principalAmt, date)
    const interest = d.interest_accrued != null
      ? Number(d.interest_accrued)
      : Math.max(0, cv - principalAmt)
    return {
      dateKey: d.deposit_date,
      tieKey: d.created_at ?? d.deposit_date,
      type: 'Deposit',
      row: withCompany(d.clients?.name, [
        formatDate(date),
        'Deposit',
        formatCurrency(principalAmt),
        `+${formatCurrency(interest)}`,
        formatCurrency(cv),
        'Active',
      ]),
    }
  })

  const withdrawalEntries: StatementEntry[] = withdrawals.map((w) => ({
    dateKey: w.withdrawal_date,
    tieKey: w.created_at ?? w.withdrawal_date,
    type: 'Withdrawal',
    row: withCompany(w.clients?.name, [
      formatDate(w.withdrawal_date),
      'Withdrawal',
      `-${formatCurrency(Number(w.amount))}`,
      `+${formatCurrency(Number(w.interest_paid))}`,
      `-${formatCurrency(Number(w.total_payout))}`,
      w.status.charAt(0).toUpperCase() + w.status.slice(1),
    ]),
  }))

  // Newest-first by the displayed transaction date (recent at top, oldest at
  // bottom). Same-date entries fall back to created_at, also newest-first, so
  // the visible Date column always reads in order.
  const statementEntries = [...depositEntries, ...withdrawalEntries].sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey > b.dateKey ? -1 : 1
    if (a.tieKey !== b.tieKey) return a.tieKey > b.tieKey ? -1 : 1
    return 0
  })

  // Column layout shifts right by one when the Company column is shown.
  const statementCols: ColStyles = showCompany
    ? {
        0: { cellWidth: 28 },
        1: { cellWidth: 22 },
        2: { cellWidth: 20 },
        3: { halign: 'right', cellWidth: 26 },
        4: { halign: 'right', cellWidth: 22, textColor: primaryColor },
        5: { halign: 'right', cellWidth: 26, fontStyle: 'bold' },
        6: { cellWidth: 20 },
      }
    : {
        0: { cellWidth: 26 },
        1: { cellWidth: 24 },
        2: { halign: 'right', cellWidth: 30 },
        3: { halign: 'right', cellWidth: 26, textColor: primaryColor },
        4: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
        5: { cellWidth: 24 },
      }

  const statementHead = showCompany
    ? ['Company', 'Date', 'Type', 'Principal', 'Interest', 'Total', 'Status']
    : ['Date', 'Type', 'Principal', 'Interest', 'Total', 'Status']

  // Column indices for Type / Principal / Total, offset by the Company column.
  const o = showCompany ? 1 : 0

  autoTable(doc, {
    startY: yPos,
    head: [statementHead],
    body: statementEntries.map((e) => e.row),
    theme: 'grid',
    headStyles: { fillColor: darkColor, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold', halign: 'left' },
    bodyStyles: { fontSize: 7, textColor: darkColor },
    columnStyles: statementCols,
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 20, right: 20 },
    // Color the Type cell (and withdrawal amounts) so debits read at a glance.
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const entry = statementEntries[data.row.index]
      if (!entry) return
      if (data.column.index === 1 + o) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = entry.type === 'Withdrawal' ? redColor : primaryColor
      }
      if (entry.type === 'Withdrawal' && (data.column.index === 2 + o || data.column.index === 4 + o)) {
        data.cell.styles.textColor = redColor
      }
    },
  })

  let finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // Footer
  finalY += 15
  doc.setDrawColor(200, 200, 200)
  doc.line(20, finalY, pageWidth - 20, finalY)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...grayColor)
  doc.text('Interest Rate: 0.5% compound per complete week (Monday-Sunday)', 20, finalY + 8)
  doc.text('Week 1 starts from the coming Monday after deposit date', 20, finalY + 14)

  const fileName = `Inessa_Holdings_Overview_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(fileName)
}
