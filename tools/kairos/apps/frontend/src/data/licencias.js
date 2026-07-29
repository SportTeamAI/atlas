// Catálogo de licencias, permisos y ausencias de Colombia (vigente 2026,
// incluye reforma Ley 2466/2025). Datos verificados contra Función Pública.
// Fuente única usada por la grilla (marcar en el día) y por el módulo de RH.
// Estos datos alimentarán el futuro módulo de liquidación de nómina.
export const LICENCIAS = [
  {
    tipo: 'VACACIONES', nombre: 'Vacaciones anuales', duracion: '15 días hábiles/año',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'CST Art. 186',
    calculo: 'Salario ordinario vigente al iniciar el disfrute. Por días: (salario mensual / 720) × días causados. No incluye horas extra ni recargos.',
    descripcion: 'Todo trabajador que preste servicios durante un año tiene derecho a 15 días hábiles consecutivos de vacaciones remuneradas, con el salario ordinario vigente al disfrutarlas. Acumulables hasta 2 años por acuerdo (CST Art. 190).',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983',
  },
  {
    tipo: 'LICENCIA_MATERNIDAD', nombre: 'Licencia de maternidad', duracion: '18 semanas',
    remunerada: 'Sí', quien_paga: 'EPS', base_legal: 'Ley 2114 de 2021 (CST Art. 236)',
    calculo: '100% del IBC que devengaba al iniciar la licencia, a cargo de la EPS (el empleador suele pagar y pedir reembolso). +2 semanas por parto múltiple o hijo con discapacidad.',
    descripcion: 'La trabajadora en embarazo tiene 18 semanas remuneradas al 100% a cargo de la EPS (1 preparto + 17 posparto). La Ley 2114/2021 permite compartir las últimas 6 semanas con el padre (licencia parental compartida). Aplica a madre adoptante.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=167967',
  },
  {
    tipo: 'LICENCIA_PATERNIDAD', nombre: 'Licencia de paternidad', duracion: '2 semanas',
    remunerada: 'Sí', quien_paga: 'EPS', base_legal: 'Ley 2114 de 2021 (CST Art. 236)',
    calculo: '100% del IBC, a cargo de la EPS, según semanas cotizadas durante la gestación. Soporte: Registro Civil de Nacimiento ante la EPS dentro de los 30 días siguientes.',
    descripcion: 'El padre tiene 2 semanas de licencia remunerada a cargo de la EPS. Aplica también al padre adoptante. La Ley 2114/2021 dejó la base en 2 semanas (incrementos futuros condicionados a metas de desempleo aún no activadas).',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=167967',
  },
  {
    tipo: 'INCAPACIDAD_ENFERMEDAD', nombre: 'Incapacidad por enfermedad general', duracion: 'Según prescripción (días 1-180)',
    remunerada: 'Sí', quien_paga: 'Empleador (días 1-2) / EPS (3+)', base_legal: 'CST Art. 227; Ley 100 de 1993',
    calculo: 'Días 1-2: empleador (práctica usual 100%). Días 3-90: 66.67% del IBC (EPS). Días 91-180: 50% del IBC. La base no puede ser inferior al SMLMV.',
    descripcion: 'En incapacidad de origen común, los 2 primeros días los asume el empleador y desde el tercero la EPS paga el subsidio: 66.67% del IBC entre los días 3 y 90, y 50% entre 91 y 180.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=16752',
  },
  {
    tipo: 'INCAPACIDAD_ACCIDENTE', nombre: 'Incapacidad por accidente / enfermedad laboral', duracion: 'Hasta 180 días (prorrogables)',
    remunerada: 'Sí', quien_paga: 'ARL', base_legal: 'Ley 776 de 2002, Art. 2 y 3',
    calculo: '100% del salario base de cotización (IBC), desde el día siguiente al accidente o inicio de la incapacidad, a cargo de la ARL.',
    descripcion: 'Cuando la incapacidad es de origen laboral, la ARL paga un subsidio del 100% del IBC, hasta por 180 días prorrogables por otros 180 para tratamiento o rehabilitación.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=16752',
  },
  {
    tipo: 'LICENCIA_LUTO', nombre: 'Licencia por luto', duracion: '5 días hábiles',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'Ley 1280 de 2009 (CST Art. 57 num. 10)',
    calculo: '100% del salario, a cargo del empleador. Se acredita con documento de autoridad competente dentro de los 30 días siguientes.',
    descripcion: 'Licencia remunerada de 5 días hábiles por muerte del cónyuge, compañero(a) permanente o familiar hasta 2º de consanguinidad, 1º de afinidad y 1º civil. La EPS debe brindar asesoría psicológica.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=34496',
  },
  {
    tipo: 'LICENCIA_VOTACION', nombre: 'Día compensatorio por votación', duracion: '½ día (1 día si fue jurado)',
    fraccion: 0.5,  // #1 medio día (paga 4 h); si fue jurado, marcarlo como día completo
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'Ley 403 de 1997, Art. 3',
    calculo: 'Medio día de descanso compensatorio remunerado, dentro del mes siguiente a la votación, con el certificado electoral. Si fue jurado, 1 día completo.',
    descripcion: 'Quien sufraga tiene media jornada de descanso compensatorio remunerado por el tiempo usado para votar, a disfrutar el mes siguiente. La Ley 2466/2025 lo ratificó y reconoce 1 día para jurados de votación.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=8791',
  },
  {
    tipo: 'PERMISO_REMUNERADO', nombre: 'Permiso remunerado (Art. 57 num. 6)', duracion: 'El tiempo necesario',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'CST Art. 57 num. 6 (Ley 2466 de 2025)',
    calculo: '100% del salario, sin descuento ni obligación de reponer el tiempo, en las causales del numeral 6 del Art. 57.',
    descripcion: 'El empleador concede permiso remunerado para: sufragio, cargos oficiales transitorios, calamidad doméstica, comisiones sindicales, citas médicas, compromisos escolares como acudiente y citaciones judiciales. La Ley 2466/2025 amplió el catálogo.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676',
  },
  {
    tipo: 'PERMISO_NO_REMUNERADO', nombre: 'Permiso / licencia no remunerada', duracion: 'Acordada',
    remunerada: 'No', quien_paga: '—', base_legal: 'CST Art. 51 y 57; Art. 58',
    calculo: 'Sin pago de salario. Suspende el contrato (CST Art. 51): no se causa salario y las semanas no cuentan para prestaciones salvo acuerdo.',
    descripcion: 'Licencia que el empleador concede voluntariamente para ausentarse temporalmente sin remuneración. Suspende el contrato de trabajo y no genera salario durante el periodo.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983',
  },
  {
    tipo: 'LICENCIA_CALAMIDAD', nombre: 'Calamidad doméstica grave', duracion: 'El tiempo razonablemente necesario',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'CST Art. 57 num. 6; Ley 2466 de 2025',
    calculo: '100% del salario, sin obligación de reponer el tiempo. El trabajador presenta los soportes al reincorporarse.',
    descripcion: 'Permiso remunerado ante un suceso grave personal o familiar (incendio/inundación de vivienda, hospitalización urgente, accidente grave de un familiar). La Ley 2466/2025 precisó el concepto.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676',
  },
  {
    tipo: 'LICENCIA_CUIDADO', nombre: 'Cuidado de menor enfermo (Ley Isaac)', duracion: '10 días hábiles/año',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'Ley 2174 de 2021',
    calculo: '100% del salario, una vez al año, a uno de los padres o custodio. Requiere certificación del médico tratante de la EPS del menor.',
    descripcion: 'Licencia de 10 días hábiles al año para que un padre o custodio cuide a un menor con enfermedad/condición terminal o cuadro severo por accidente grave. Continua o discontinua por acuerdo.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=85043',
  },
  {
    tipo: 'PERMISO_CITA_MEDICA', nombre: 'Permiso por cita médica', duracion: 'El tiempo de la cita',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'CST Art. 57 num. 6 (Ley 2466 de 2025)',
    calculo: '100% del salario, sin descuento. Incluye diagnóstico y tratamiento de endometriosis. Se informa y se presenta el soporte de la cita.',
    descripcion: 'La Ley 2466/2025 formalizó como permiso remunerado la asistencia a citas médicas de urgencia o programadas con especialistas (incluida endometriosis). No es una "licencia menstrual" general del sector privado.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676',
  },
  {
    tipo: 'LICENCIA_SINDICAL', nombre: 'Permiso / comisión sindical', duracion: 'El necesario para la comisión',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'CST Art. 57 num. 6; Ley 584 de 2000',
    calculo: '100% del salario; no descontable ni compensable en tiempo. Condicionado a que las ausencias no afecten el funcionamiento de la empresa.',
    descripcion: 'Permiso remunerado para desempeñar comisiones sindicales o asistir al entierro de compañeros, avisando con antelación. Los permisos sindicales no se descuentan del salario.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4280',
  },
  {
    tipo: 'PERMISO_BICI', nombre: 'Día compensatorio por uso de bicicleta', duracion: '1 día/semestre',
    remunerada: 'Sí', quien_paga: 'Empleador', base_legal: 'Ley 1811 de 2016; Ley 2466 de 2025',
    calculo: '1 día remunerado por cada 6 meses de uso continuo y certificado de la bicicleta para ir al trabajo, por acuerdo entre las partes.',
    descripcion: 'Incentivo de movilidad sostenible: un día de descanso remunerado por cada semestre de uso continuo certificado de la bicicleta como medio de transporte al trabajo.',
    url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676',
  },
  {
    tipo: 'GUARDIA', nombre: 'Guardia (disponibilidad)', duracion: 'El día asignado',
    remunerada: 'No', quien_paga: '—', base_legal: 'Acuerdo interno del área',
    calculo: 'No se paga ni cuenta como tiempo trabajado: es una persona de respaldo disponible por si se necesita.',
    descripcion: 'Disponibilidad de respaldo (on-call). La persona queda pendiente ese día pero no está trabajando; no genera horas ni pago.',
  },
]

export const LIC_MAP = Object.fromEntries(LICENCIAS.map((l) => [l.tipo, l]))
export const esPagada = (tipo) => LIC_MAP[tipo]?.remunerada !== 'No'
