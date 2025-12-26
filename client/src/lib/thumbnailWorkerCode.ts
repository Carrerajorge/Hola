const workerCode = `
self.onmessage = async function(e) {
  const { id, file, type, maxSize = 120 } = e.data;
  
  try {
    let thumbnail = null;
    
    if (type === 'image') {
      thumbnail = await generateImageThumbnail(file, maxSize);
    } else if (type === 'video') {
      thumbnail = await generateVideoThumbnail(file, maxSize);
    } else if (type === 'document') {
      thumbnail = getDocumentIcon(file.name);
    }
    
    self.postMessage({ id, thumbnail, error: null });
  } catch (error) {
    self.postMessage({ id, thumbnail: null, error: error.message });
  }
};

async function generateImageThumbnail(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = new OffscreenCanvas(maxSize, maxSize);
        const ctx = canvas.getContext('2d');
        
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function generateVideoThumbnail(file, maxSize) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    
    video.onloadeddata = () => {
      video.currentTime = 1;
    };
    
    video.onseeked = () => {
      const canvas = new OffscreenCanvas(maxSize, maxSize);
      const ctx = canvas.getContext('2d');
      
      let width = video.videoWidth;
      let height = video.videoHeight;
      
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);
      
      canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          URL.revokeObjectURL(video.src);
          resolve(reader.result);
        };
        reader.readAsDataURL(blob);
      });
    };
    
    video.onerror = reject;
    video.src = URL.createObjectURL(file);
  });
}

function getDocumentIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const icons = {
    pdf: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNlZjQ0NDQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHBhdGggZD0iTTEwIDEyaC0ydjRoMiIvPjxwYXRoIGQ9Ik0xNCAxMmgtMnY0Ii8+PHBhdGggZD0iTTE4IDEyaC0ydjJoMnYyaC0yIi8+PC9zdmc+',
    doc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNTYzZWIiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHBhdGggZD0iTTEwIDEzSDgiLz48cGF0aCBkPSJNMTYgMTdIOCIvPjxwYXRoIGQ9Ik0xNiA5SDgiLz48L3N2Zz4=',
    docx: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNTYzZWIiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHBhdGggZD0iTTEwIDEzSDgiLz48cGF0aCBkPSJNMTYgMTdIOCIvPjxwYXRoIGQ9Ik0xNiA5SDgiLz48L3N2Zz4=',
    xls: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxNjk0NGEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHBhdGggZD0iTTggMTNsMiAyLTItMiIvPjxwYXRoIGQ9Ik0xMiAxM2wtMiAyIDItMiIvPjwvc3ZnPg==',
    xlsx: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxNjk0NGEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHBhdGggZD0iTTggMTNsMiAyLTItMiIvPjxwYXRoIGQ9Ik0xMiAxM2wtMiAyIDItMiIvPjwvc3ZnPg==',
    ppt: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmOTczMTYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHJlY3Qgd2lkdGg9IjgiIGhlaWdodD0iNiIgeD0iOCIgeT0iMTIiIHJ4PSIxIi8+PC9zdmc+',
    pptx: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmOTczMTYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHJlY3Qgd2lkdGg9IjgiIGhlaWdodD0iNiIgeD0iOCIgeT0iMTIiIHJ4PSIxIi8+PC9zdmc+',
    txt: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PHBhdGggZD0iTTE2IDEzSDgiLz48cGF0aCBkPSJNMTYgMTdIOCIvPjwvc3ZnPg==',
    default: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhaIi8+PHBhdGggZD0iTTE0IDJWOGg2Ii8+PC9zdmc+'
  };
  return icons[ext] || icons.default;
}
`;

export function createThumbnailWorker(): Worker {
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  return new Worker(url);
}

export async function generateThumbnailInWorker(
  file: File | Blob,
  type: 'image' | 'video' | 'document',
  fileName?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const worker = createThumbnailWorker();
    const id = Date.now().toString();

    worker.onmessage = (e) => {
      if (e.data.id === id) {
        worker.terminate();
        resolve(e.data.thumbnail);
      }
    };

    worker.onerror = () => {
      worker.terminate();
      resolve(null);
    };

    const fileWithName = file instanceof File ? file : new File([file], fileName || 'file');
    worker.postMessage({ id, file: fileWithName, type });
  });
}

export function generateThumbnailSync(
  file: File | Blob,
  type: 'image' | 'video' | 'document',
  maxSize = 120
): Promise<string | null> {
  return new Promise((resolve) => {
    if (type === 'document') {
      const name = file instanceof File ? file.name : 'file';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const icons: Record<string, string> = {
        pdf: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNlZjQ0NDQiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTE0IDJINmEyIDIgMCAwIDAtMiAydjE2YTIgMiAwIDAgMCAyIDJoMTJhMiAyIDAgMCAwIDItMlY4WiIvPjxwYXRoIGQ9Ik0xNCAyVjhoNiIvPjwvc3ZnPg==',
        doc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNTYzZWIiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTE0IDJINmEyIDIgMCAwIDAtMiAydjE2YTIgMiAwIDAgMCAyIDJoMTJhMiAyIDAgMCAwIDItMlY4WiIvPjxwYXRoIGQ9Ik0xNCAyVjhoNiIvPjwvc3ZnPg==',
        docx: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNTYzZWIiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTE0IDJINmEyIDIgMCAwIDAtMiAydjE2YTIgMiAwIDAgMCAyIDJoMTJhMiAyIDAgMCAwIDItMlY4WiIvPjxwYXRoIGQ9Ik0xNCAyVjhoNiIvPjwvc3ZnPg==',
        xls: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxNjk0NGEiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTE0IDJINmEyIDIgMCAwIDAtMiAydjE2YTIgMiAwIDAgMCAyIDJoMTJhMiAyIDAgMCAwIDItMlY4WiIvPjxwYXRoIGQ9Ik0xNCAyVjhoNiIvPjwvc3ZnPg==',
        xlsx: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxNjk0NGEiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTE0IDJINmEyIDIgMCAwIDAtMiAydjE2YTIgMiAwIDAgMCAyIDJoMTJhMiAyIDAgMCAwIDItMlY4WiIvPjxwYXRoIGQ9Ik0xNCAyVjhoNiIvPjwvc3ZnPg==',
      };
      resolve(icons[ext] || icons.doc);
      return;
    }

    if (type === 'image') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }

          let { width, height } = img;
          if (width > height) {
            if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
          } else {
            if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(null);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }

    resolve(null);
  });
}
