export default function RefundsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Refunds</h1>
      <div className="rounded-lg border border-zinc-200 bg-white p-8">
        <p className="mb-4 text-zinc-600">
          Stripe integration in progress. Refunds will be processed here once Stripe is connected.
        </p>
        <p className="text-sm text-zinc-500">
          When Stripe is integrated, this page will allow admins to issue refunds for subscription
          payments and view refund request history.
        </p>
      </div>
    </div>
  );
}
