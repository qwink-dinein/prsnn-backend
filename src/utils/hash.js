import bcrypt from "bcrypt";

export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};


// It compares original password entered by user to its 
export const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};
