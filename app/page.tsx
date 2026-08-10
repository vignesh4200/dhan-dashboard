import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function Home() {
  const hasSession = cookies().has("session");
  redirect(hasSession ? "/dashboard" : "/login");
}
