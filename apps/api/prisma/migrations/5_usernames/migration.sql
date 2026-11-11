-- Login por nome de usuário (ex.: "Admin" no back-office), sem diferenciar maiúsculas
ALTER TABLE "users" ADD COLUMN "username" CITEXT;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
