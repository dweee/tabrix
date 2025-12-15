/**
 * Composable for managing file attachments.
 * Handles file selection, conversion, and removal.
 */
import { ref } from 'vue';
import type { AgentAttachment } from 'chrome-mcp-shared';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function useAttachments() {
  const attachments = ref<AgentAttachment[]>([]);
  const fileInputRef = ref<HTMLInputElement | null>(null);
  const error = ref<string | null>(null);

  // Open file picker
  function openFilePicker(): void {
    fileInputRef.value?.click();
  }

  // Convert file to base64
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:xxx;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Handle file selection
  async function handleFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    error.value = null;

    for (const file of files) {
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        error.value = `File "${file.name}" is too large. Maximum size is 10MB.`;
        continue;
      }

      try {
        const base64 = await fileToBase64(file);
        attachments.value.push({
          type: file.type.startsWith('image/') ? 'image' : 'file',
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64: base64,
        });
      } catch (err) {
        console.error('Failed to read file:', err);
        error.value = `Failed to read file "${file.name}".`;
      }
    }

    // Clear input to allow selecting the same file again
    input.value = '';
  }

  // Remove attachment by index
  function removeAttachment(index: number): void {
    attachments.value.splice(index, 1);
  }

  // Clear all attachments
  function clearAttachments(): void {
    attachments.value = [];
  }

  // Get attachments for sending
  function getAttachments(): AgentAttachment[] | undefined {
    return attachments.value.length > 0 ? [...attachments.value] : undefined;
  }

  return {
    // State
    attachments,
    fileInputRef,
    error,

    // Methods
    openFilePicker,
    handleFileSelect,
    removeAttachment,
    clearAttachments,
    getAttachments,
  };
}
