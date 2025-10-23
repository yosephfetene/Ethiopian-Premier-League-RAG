import "./assets/global.css";

export const metadata = {
  title: "epldata",
  description: "Ethiopian Premier League data chatbot ai",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;