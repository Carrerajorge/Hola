import { describe, it, expect } from 'vitest';

import { normalizeFileForUpload } from '../../client/src/lib/attachmentIngest';

describe('normalizeFileForUpload', () => {
  it('infers MIME for .doc when declared type is octet-stream', () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'test.doc', { type: 'application/octet-stream' });
    const out = normalizeFileForUpload(f);
    expect(out.type).toBe('application/msword');
    expect(out.size).toBe(f.size);
  });

  it('infers MIME for .docx when declared type is application/zip', () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'test.docx', { type: 'application/zip' });
    const out = normalizeFileForUpload(f);
    expect(out.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('normalizes legacy image MIME aliases', () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/pjpeg' });
    const out = normalizeFileForUpload(f);
    expect(out.type).toBe('image/jpeg');
  });

  it('returns the same File when the declared type is already standard', () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    const out = normalizeFileForUpload(f);
    expect(out).toBe(f);
  });

  it('infers MIME when type is empty', () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: '' });
    const out = normalizeFileForUpload(f);
    expect(out.type).toBe('application/pdf');
    expect(out.size).toBe(f.size);
  });
});

