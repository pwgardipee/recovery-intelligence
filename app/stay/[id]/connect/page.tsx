import { redirect } from "next/navigation";

export default async function LegacyConnectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/user/stays/${id}`);
}
