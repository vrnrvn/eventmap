import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-100">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900">
          Access Denied
        </h1>
        <p className="mb-6 text-zinc-600">
          You do not have admin access to this dashboard.
        </p>
        <Link
          href="/login"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Back to Login
        </Link>
      </div>
    </div>
  );
}
