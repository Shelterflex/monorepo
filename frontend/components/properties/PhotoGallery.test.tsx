// PhotoGallery.test.tsx – component tests for PhotoGallery
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/components/__tests__/test-utils';
import { PhotoGallery } from '@/components/properties/PhotoGallery';
import '@testing-library/jest-dom';

// Mock next/image to simple img element
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} data-next-image />;
  },
}));

// Helper to create a mock FileList
function createFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  files.forEach((file) => dt.items.add(file));
  return dt.files;
}

describe('PhotoGallery component', () => {
  const mockPhotos = [
    {
      id: '1',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
      orderIndex: 0,
      isFeatured: true,
      fileName: 'photo1.png',
      uploadedAt: new Date(),
    },
    {
      id: '2',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUB',
      orderIndex: 1,
      isFeatured: false,
      fileName: 'photo2.png',
      uploadedAt: new Date(),
    },
  ];

  it('renders initial photos and featured badge', () => {
    render(<PhotoGallery propertyId="prop-123" initialPhotos={mockPhotos} />);

    // Two photos should be present
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    // Featured badge should appear on the first photo
    expect(screen.getByText(/featured/i)).toBeInTheDocument();
  });

  it('shows empty state when no photos', () => {
    render(<PhotoGallery propertyId="prop-123" />);
    expect(screen.getByText(/no photos yet/i)).toBeInTheDocument();
    const uploadButton = screen.getByRole('button', { name: /upload your first photo/i });
    expect(uploadButton).toBeInTheDocument();
  });

  it('handles file upload and displays new photo', async () => {
    render(<PhotoGallery propertyId="prop-123" />);
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    const input = screen.getByLabelText(/upload photos/i, { selector: 'input' });
    // Simulate file selection
    Object.defineProperty(input, 'files', { value: createFileList([file]) });
    fireEvent.change(input);

    // Wait for async FileReader to load and photo to appear
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
    expect(screen.getByAltText('test.png')).toBeInTheDocument();
  });

  it('opens lightbox on photo click and navigates via keyboard', async () => {
    render(<PhotoGallery propertyId="prop-123" initialPhotos={mockPhotos} />);
    const firstPhoto = screen.getAllByRole('img')[0];
    fireEvent.click(firstPhoto);
    // Lightbox should appear
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    // Press right arrow to go to next photo
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => {
      const displayed = screen.getByAltText('photo2.png');
      expect(displayed).toBeInTheDocument();
    });
    // Press Escape to close
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });
  });
});
