"use server";

import { all, bool, formAction, num, optStr, str } from "@/server/actions";
import { approveVideoNow, createVideoProject, moveScene, removeScene, requestRender, updateScene, updateVideoSettings } from "@/server/services/videos";

const bid = (f: FormData) => str(f, "businessId");

export async function createVideoAction(form: FormData) {
  await formAction(form, async (actor) => {
    const p = await createVideoProject(actor, bid(form), { title: optStr(form, "title") ?? undefined, format: str(form, "format") === "horizontal" ? "horizontal" : "vertical", assetIds: all(form, "assetIds"), brief: optStr(form, "brief"), destinations: all(form, "destinations") });
    return { redirect: `/b/${bid(form)}/videos/${p.id}`, ok: "Video drafted. Review the script, then render." };
  });
}

export async function videoAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    const projectId = str(form, "projectId");
    const sceneId = str(form, "sceneId");
    switch (str(form, "op")) {
      case "scene":
        await updateScene(actor, businessId, projectId, sceneId, {
          narration: str(form, "narration"),
          overlayText: optStr(form, "overlayText"),
          voiceId: optStr(form, "voiceId") ?? undefined,
          deliveryInstruction: optStr(form, "deliveryInstruction"),
          durationMs: Math.round((num(form, "seconds") ?? 4) * 1000),
          transition: (str(form, "transition") || "fade") as "cut" | "fade" | "slide",
          effect: (str(form, "effect") || "zoom_in") as "none" | "zoom_in" | "zoom_out" | "pan",
          mediaAssetId: optStr(form, "mediaAssetId") ?? undefined,
        });
        return "Scene saved";
      case "up":
      case "down":
        await moveScene(actor, businessId, projectId, sceneId, str(form, "op") === "up" ? -1 : 1);
        return "Scene moved";
      case "remove":
        await removeScene(actor, businessId, projectId, sceneId);
        return "Scene removed";
      case "settings":
        await updateVideoSettings(actor, businessId, projectId, {
          title: optStr(form, "title") ?? undefined,
          destinations: all(form, "destinations"),
          textOverlay: bool(form, "textOverlay"),
          imageEffects: bool(form, "imageEffects"),
          logoWatermark: bool(form, "logoWatermark"),
          introLogo: bool(form, "introLogo"),
          music: str(form, "music") || "auto",
          musicVolume: (num(form, "musicVolume") ?? 15) / 100,
          endingText: optStr(form, "endingText") ?? undefined,
        });
        return "Settings saved";
      case "render":
        await requestRender(actor, businessId, projectId);
        return "Rendering started. This page updates when you refresh.";
      case "approve":
        await approveVideoNow(actor, businessId, projectId);
        return "Approved and queued for publishing";
    }
  });
}
