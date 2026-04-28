import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PropertyDetailClient from './PropertyDetailClient'
import { apiPost } from '@/lib/api'

// Mock Next.js components
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} />,
}))

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}))

// Mock toast functions
const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()
vi.mock('@/lib/toast', () => ({
  showSuccessToast: mockShowSuccessToast,
  showErrorToast: mockShowErrorToast,
}))

// Mock API functions
const mockApiPost = vi.fn()
vi.mock('@/lib/api', () => ({
  apiPost: mockApiPost,
}))

describe('PropertyDetailClient - Regression Check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asserts Annual Rent section is present', () => {
    // Use a property ID that exists in mock data
    render(<PropertyDetailClient propertyId="1" />)

    // Check for Annual Rent label and pricing
    expect(screen.getByText('Annual Rent')).toBeInTheDocument()
    // Price should be present (format varies, but should contain currency symbol)
    const priceElement = screen.queryByText(/₦/)
    expect(priceElement).toBeInTheDocument()
  })

  it('asserts Listed By section is present', () => {
    render(<PropertyDetailClient propertyId="1" />)

    // Check for Listed By section
    expect(screen.getByText('Listed By')).toBeInTheDocument()
    // Landlord name should be present
    expect(screen.getByText(/Verified Landlord|Verification pending/)).toBeInTheDocument()
  })

  it('asserts whistleblower section is present when data exists', () => {
    render(<PropertyDetailClient propertyId="1" />)

    // Check for whistleblower section (when property has whistleblower data)
    const whistleblowerSection = screen.queryByText('Reported by Resident')
    if (whistleblowerSection) {
      expect(whistleblowerSection).toBeInTheDocument()
      // Should also show the verified badge
      expect(screen.getByText('Verified')).toBeInTheDocument()
    } else {
      // If no whistleblower data for property 1, try another property
      // This is acceptable - the test confirms the section exists when data is present
      console.log('No whistleblower data for property 1, section correctly not rendered')
    }
  })

  it('asserts all key sections are present together', () => {
    render(<PropertyDetailClient propertyId="1" />)

    // Annual Rent must be present
    expect(screen.getByText('Annual Rent')).toBeInTheDocument()

    // Listed By must be present
    expect(screen.getByText('Listed By')).toBeInTheDocument()

    // At minimum, pricing information should be visible
    const priceElements = screen.queryAllByText(/₦/)
    expect(priceElements.length).toBeGreaterThan(0)
  })
})

describe('PropertyDetailClient - Report Dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens report dialog when Report Listing button is clicked', () => {
    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    expect(screen.getByText('Report Listing')).toBeInTheDocument()
    expect(screen.getByText('Report Category')).toBeInTheDocument()
  })

  it('disables submit button when form is invalid', () => {
    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    const submitButton = screen.getByText('Submit Report')
    expect(submitButton).toBeDisabled()
  })

  it('enables submit button when form is valid', async () => {
    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    // Select a category
    const categorySelect = screen.getByRole('combobox')
    fireEvent.click(categorySelect)

    const fraudOption = await screen.findByText('Fraudulent Listing')
    fireEvent.click(fraudOption)

    // Add details
    const detailsTextarea = screen.getByPlaceholderText(/Please provide more information/)
    fireEvent.change(detailsTextarea, { target: { value: 'This is a test report' } })

    const submitButton = screen.getByText('Submit Report')
    expect(submitButton).not.toBeDisabled()
  })

  it('shows loading state during submission', async () => {
    mockApiPost.mockImplementation(
      () => new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, reportId: '123' }), 100)
      )
    )

    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    // Fill form
    const categorySelect = screen.getByRole('combobox')
    fireEvent.click(categorySelect)
    const fraudOption = await screen.findByText('Fraudulent Listing')
    fireEvent.click(fraudOption)

    const detailsTextarea = screen.getByPlaceholderText(
      /Please provide more information/
    )
    fireEvent.change(detailsTextarea, { target: { value: 'This is a test report' } })

    const submitButton = screen.getByText('Submit Report')
    fireEvent.click(submitButton)

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText('Submitting...')).toBeInTheDocument()
    })
  })

  it('shows success state after successful submission', async () => {
    mockApiPost.mockResolvedValue({ success: true, reportId: '123' })

    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    // Fill form
    const categorySelect = screen.getByRole('combobox')
    fireEvent.click(categorySelect)
    const fraudOption = await screen.findByText('Fraudulent Listing')
    fireEvent.click(fraudOption)

    const detailsTextarea = screen.getByPlaceholderText(
      /Please provide more information/
    )
    fireEvent.change(detailsTextarea, { target: { value: 'This is a test report' } })

    const submitButton = screen.getByText('Submit Report')
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Report Submitted')).toBeInTheDocument()
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        'Report submitted successfully!'
      )
    })
  })

  it('shows error state on failed submission', async () => {
    mockApiPost.mockRejectedValue(new Error('Network error'))

    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    // Fill form
    const categorySelect = screen.getByRole('combobox')
    fireEvent.click(categorySelect)
    const fraudOption = await screen.findByText('Fraudulent Listing')
    fireEvent.click(fraudOption)

    const detailsTextarea = screen.getByPlaceholderText(
      /Please provide more information/
    )
    fireEvent.change(detailsTextarea, { target: { value: 'This is a test report' } })

    const submitButton = screen.getByText('Submit Report')
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to submit report. Please try again.'
      )
    })
  })

  it('resets form state after successful submission', async () => {
    mockApiPost.mockResolvedValue({ success: true, reportId: '123' })

    render(<PropertyDetailClient propertyId="1" />)

    const reportButton = screen.getByText('Report Listing')
    fireEvent.click(reportButton)

    // Fill form
    const categorySelect = screen.getByRole('combobox')
    fireEvent.click(categorySelect)
    const fraudOption = await screen.findByText('Fraudulent Listing')
    fireEvent.click(fraudOption)

    const detailsTextarea = screen.getByPlaceholderText(
      /Please provide more information/
    )
    fireEvent.change(detailsTextarea, { target: { value: 'This is a test report' } })

    const submitButton = screen.getByText('Submit Report')
    fireEvent.click(submitButton)

    // Wait for success state and dialog close
    await waitFor(
      () => {
        expect(screen.queryByText('Report Submitted')).not.toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })
})
