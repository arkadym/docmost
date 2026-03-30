import api from "@/lib/api-client.ts";

/**
 * Converts a .xmind File to PlantUML attrs ready for setPlantUml / updateAttributes.
 * Caller is responsible for uploading the .xmind file and passing its attachmentId.
 */
export async function convertXmindToPlantUmlAttrs(
  file: File,
  pageId: string,
  xmindAttachmentId: string,
  existingPlantumlAttachmentId?: string | null,
): Promise<{
  code: string;
  src: string;
  title: string | undefined;
  size: number | null;
  attachmentId: string;
  xmindAttachmentId: string;
  xmindModified: false;
}> {
  // 1. Convert XMind → PlantUML code
  const form = new FormData();
  form.append("file", file);
  const convertRes = await api.post<{ plantumlCode: string }>(
    "/diagrams/xmind/convert",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  const plantumlCode = convertRes.data.plantumlCode;

  // 2. Render PlantUML → SVG attachment
  const renderRes = await api.post("/diagrams/plantuml/render", {
    code: plantumlCode,
    pageId,
    attachmentId: existingPlantumlAttachmentId ?? undefined,
  });
  const { src, attachmentId, title, size, updatedAt } = renderRes.data;

  return {
    code: plantumlCode,
    src: src + `?t=${new Date(updatedAt).getTime()}`,
    title,
    size,
    attachmentId,
    xmindAttachmentId,
    xmindModified: false,
  };
}
