-- Login com Google (5.1): vínculo pelo identificador estável da conta Google
ALTER TABLE "users" ADD COLUMN "google_sub" TEXT;
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");
