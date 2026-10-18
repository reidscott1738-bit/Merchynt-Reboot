"use server";

import { formAction } from "@/server/actions";
import { businessFromForm } from "@/server/forms";
import { createBusiness } from "@/server/services/business";

export async function createBusinessAction(form: FormData) {
  await formAction(form, async (actor) => {
    const b = await createBusiness(actor, businessFromForm(form));
    return { redirect: `/b/${b.id}/onboarding`, ok: "Business created. Let's set it up." };
  });
}
