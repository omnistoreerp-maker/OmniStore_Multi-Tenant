import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="tech text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 text-3xl font-extrabold text-foreground">الصفحة غير موجودة</h1>
      <p className="mt-2 text-muted-foreground">قد يكون الرابط غير صحيح أو أن الصفحة قد أزيلت.</p>
      <Link
        to="/"
        className="btn-focus mt-6 inline-flex rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        العودة للمتجر
      </Link>
    </div>
  );
}
