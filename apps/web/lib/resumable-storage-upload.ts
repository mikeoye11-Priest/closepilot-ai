import * as tus from "tus-js-client";
import type { SupabaseClient } from "@supabase/supabase-js";

const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

export async function uploadFinanceFileResumably({
  supabase,
  bucket,
  storageKey,
  file,
  onProgress,
}: {
  supabase: SupabaseClient;
  bucket: string;
  storageKey: string;
  file: File;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Private upload storage is not configured.");

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Your session expired before the large upload started. Sign in again and retry.");

  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: anonKey,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_BYTES,
      metadata: {
        bucketName: bucket,
        objectName: storageKey,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: (uploadError) => reject(uploadError),
      onProgress: (uploadedBytes, totalBytes) => onProgress?.(uploadedBytes, totalBytes),
      onSuccess: () => resolve(),
    });

    upload.findPreviousUploads().then((previousUploads) => {
      const previous = previousUploads.find((item) => item.uploadUrl);
      if (previous) upload.resumeFromPreviousUpload(previous);
      upload.start();
    }).catch(reject);
  });
}
