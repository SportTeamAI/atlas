// Tipos de contrato laboral en Colombia (informativo). Se asignan al empleado.
export const CONTRATOS = [
  {
    tipo: 'indefinido', nombre: 'Término indefinido', base_legal: 'CST Art. 47',
    descripcion: 'No tiene fecha de terminación; es el más estable. Si se termina sin justa causa, genera indemnización. Es la regla general cuando no se pacta otra modalidad por escrito.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983',
  },
  {
    tipo: 'fijo', nombre: 'Término fijo', base_legal: 'CST Art. 46',
    descripcion: 'Tiene fecha de terminación, hasta 3 años, renovable. Requiere preaviso escrito de 30 días para no prorrogarlo; si no se da, se renueva automáticamente.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983',
  },
  {
    tipo: 'aprendizaje', nombre: 'Contrato de aprendizaje', base_legal: 'Ley 789 de 2002',
    descripcion: 'Modalidad especial de formación (p. ej. SENA). No es un contrato laboral pleno: el aprendiz recibe apoyo de sostenimiento y afiliación a salud y riesgos.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=6778',
  },
]
export const CONTRATO_MAP = Object.fromEntries(CONTRATOS.map((c) => [c.tipo, c]))
