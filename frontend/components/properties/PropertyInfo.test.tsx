// PropertyInfo.test.tsx – component tests for PropertyInfo
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/components/__tests__/test-utils';
import { PropertyInfo } from '@/components/properties/PropertyInfo';
import '@testing-library/jest-dom';

// Mock toast helpers
vi.mock('@/lib/toast', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const mockOnFavoriteToggle = vi.fn();

describe('PropertyInfo component', () => {
  const defaultProps = {
    title: 'Elegant Studio Apartment',
    address: '123 Main St, Lagos',
    verificationStatus: 'VERIFIED' as const,
    beds: 1,
    baths: 1,
    sqm: 45,
    isFavorite: false,
    onFavoriteToggle: mockOnFavoriteToggle,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title, address and verification badge', () => {
    render(<PropertyInfo {...defaultProps} />);
    expect(screen.getByRole('heading', { name: /elegant studio apartment/i })).toBeInTheDocument();
    expect(screen.getByText(/123 main st, lagos/i)).toBeInTheDocument();
    expect(screen.getByText(/verified by/i)).toBeInTheDocument();
  });

  it('shows correct feature values (beds, baths, sqm)', () => {
    render(<PropertyInfo {...defaultProps} />);
    expect(screen.getByText(/1 beds/i)).toBeInTheDocument();
    expect(screen.getByText(/1 baths/i)).toBeInTheDocument();
    expect(screen.getByText(/45 m²/i)).toBeInTheDocument();
  });

  it('calls onFavoriteToggle when favorite button is clicked', () => {
    render(<PropertyInfo {...defaultProps} />);
    const favoriteBtn = screen.getByRole('button', { name: /heart/i });
    fireEvent.click(favoriteBtn);
    expect(mockOnFavoriteToggle).toHaveBeenCalledTimes(1);
  });

  it('copies link to clipboard and shows success toast on share', async () => {
    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    const { showSuccessToast } = await import('@/lib/toast');
    render(<PropertyInfo {...defaultProps} />);
    const shareBtn = screen.getByRole('button', { name: /share2/i });
    fireEvent.click(shareBtn);
    expect(writeTextMock).toHaveBeenCalledWith(window.location.href);
    // Wait for toast call
    expect(showSuccessToast).toHaveBeenCalledWith('Link copied to clipboard!');
  });

  it('shows error toast when clipboard write fails', async () => {
    const error = new Error('Permission denied');
    const writeTextMock = vi.fn().mockRejectedValue(error);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    const { showErrorToast } = await import('@/lib/toast');
    render(<PropertyInfo {...defaultProps} />);
    const shareBtn = screen.getByRole('button', { name: /share2/i });
    fireEvent.click(shareBtn);
    expect(writeTextMock).toHaveBeenCalled();
    // The component passes the error object and a custom message
    expect(showErrorToast).toHaveBeenCalledWith(error, 'Failed to copy link. Please try again.');
  });
});
