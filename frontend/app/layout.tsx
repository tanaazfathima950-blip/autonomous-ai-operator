import "./globals.css";

export const metadata = {
  title: "Autonomous AI Operator — Internship & Task Automation",
  description:
    "Agentic AI that researches internships, saves to a spreadsheet, drafts emails and waits for your approval",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}