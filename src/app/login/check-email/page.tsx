import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthShell } from "../auth-shell";

export default function CheckEmailPage() {
  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <MailCheck className="size-4 shrink-0 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-foreground">
            A sign-in link has been sent to your email address.
          </p>
          <p className="text-xs text-muted-foreground">
            Demo mode: the sign-in link prints to the server console.
          </p>
          <Link
            href="/login"
            className="inline-block text-xs font-medium text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
