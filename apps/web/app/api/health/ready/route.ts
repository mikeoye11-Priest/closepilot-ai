import { GET as readiness } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return readiness();
}
