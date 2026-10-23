run:
- ui: npm run dev
- robot: npm run dev
- middlend: python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 
