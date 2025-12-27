import { Router } from 'express';

const router = Router();

// AI command endpoint for Excel spreadsheet operations
router.post('/excel-command', async (req, res) => {
  try {
    const { command, type, range, currentData } = req.body;
    
    if (!command || !range) {
      return res.status(400).json({ error: 'Command and range are required' });
    }
    
    const commandLower = command.toLowerCase();
    const rowCount = Math.abs(range.endRow - range.startRow) + 1;
    const colCount = Math.abs(range.endCol - range.startCol) + 1;
    
    // Handle different command types
    if (commandLower.includes('ciudad') || commandLower.includes('cities') || commandLower.includes('city')) {
      const cities = [
        'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 
        'Málaga', 'Zaragoza', 'Murcia', 'Palma', 'Las Palmas',
        'Alicante', 'Córdoba', 'Valladolid', 'Vigo', 'Gijón',
        'Granada', 'A Coruña', 'Vitoria', 'Elche', 'Oviedo'
      ];
      const count = Math.min(rowCount, cities.length);
      res.json({ columnData: cities.slice(0, count) });
    }
    else if (commandLower.includes('país') || commandLower.includes('pais') || commandLower.includes('countr')) {
      const countries = [
        'España', 'Francia', 'Alemania', 'Italia', 'Portugal',
        'Reino Unido', 'Países Bajos', 'Bélgica', 'Suiza', 'Austria',
        'Polonia', 'Suecia', 'Noruega', 'Dinamarca', 'Finlandia'
      ];
      const count = Math.min(rowCount, countries.length);
      res.json({ columnData: countries.slice(0, count) });
    }
    else if (commandLower.includes('nombre') || commandLower.includes('name')) {
      const names = [
        'Ana García', 'Carlos López', 'María Rodríguez', 'Juan Martínez', 'Laura Sánchez',
        'Pedro Fernández', 'Carmen Ruiz', 'Antonio Díaz', 'Lucía Moreno', 'Francisco Álvarez',
        'Elena Torres', 'Miguel Romero', 'Isabel Navarro', 'Rafael Domínguez', 'Patricia Jiménez',
        'Daniel Muñoz', 'Sofía Molina', 'Alejandro Suárez', 'Paula Ortega', 'Andrés Castillo'
      ];
      const count = Math.min(rowCount, names.length);
      res.json({ columnData: names.slice(0, count) });
    }
    else if (commandLower.includes('producto') || commandLower.includes('product')) {
      const products = [
        'Laptop Pro 15"', 'Smartphone X12', 'Tablet Air', 'Monitor 4K 27"', 'Teclado Mecánico',
        'Mouse Inalámbrico', 'Webcam HD', 'Auriculares Bluetooth', 'Altavoz Portátil', 'Cargador USB-C',
        'Disco SSD 1TB', 'Memoria RAM 16GB', 'Tarjeta Gráfica RTX', 'Router WiFi 6', 'Hub USB 3.0'
      ];
      const count = Math.min(rowCount, products.length);
      res.json({ columnData: products.slice(0, count) });
    }
    else if (commandLower.includes('email') || commandLower.includes('correo')) {
      const emails = Array.from({ length: rowCount }, (_, i) => {
        const names = ['ana', 'carlos', 'maria', 'juan', 'laura', 'pedro', 'carmen', 'antonio'];
        const domains = ['gmail.com', 'outlook.com', 'empresa.es', 'mail.com'];
        return `${names[i % names.length]}${i + 1}@${domains[i % domains.length]}`;
      });
      res.json({ columnData: emails });
    }
    else if ((commandLower.includes('número') || commandLower.includes('number') || commandLower.includes('venta') || commandLower.includes('sales')) && !commandLower.includes('tabla') && !commandLower.includes('inventario') && !commandLower.includes('registro')) {
      const numbers = Array.from({ length: rowCount }, () => 
        Math.floor(Math.random() * 9000 + 1000)
      );
      res.json({ columnData: numbers.map(String) });
    }
    else if (commandLower.includes('precio') || commandLower.includes('price')) {
      const prices = Array.from({ length: rowCount }, () => 
        (Math.random() * 990 + 10).toFixed(2)
      );
      res.json({ columnData: prices.map(p => `€${p}`) });
    }
    else if (commandLower.includes('porcentaje') || commandLower.includes('percent')) {
      const percentages = Array.from({ length: rowCount }, () => 
        (Math.random() * 100).toFixed(1)
      );
      res.json({ columnData: percentages.map(p => `${p}%`) });
    }
    else if (commandLower.includes('fecha') || commandLower.includes('date')) {
      const dates = Array.from({ length: rowCount }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() + i);
        return date.toLocaleDateString('es-ES');
      });
      res.json({ columnData: dates });
    }
    else if (commandLower.includes('mes') || commandLower.includes('month')) {
      const months = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
      ];
      const count = Math.min(rowCount, months.length);
      res.json({ columnData: months.slice(0, count) });
    }
    else if (commandLower.includes('día') || commandLower.includes('dia') || commandLower.includes('day')) {
      const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      const count = Math.min(rowCount, days.length);
      res.json({ columnData: days.slice(0, count) });
    }
    else if (commandLower.includes('estado') || commandLower.includes('status')) {
      const statuses = ['Pendiente', 'En Proceso', 'Completado', 'Cancelado', 'En Espera'];
      const statusData = Array.from({ length: rowCount }, (_, i) => 
        statuses[i % statuses.length]
      );
      res.json({ columnData: statusData });
    }
    else if (commandLower.includes('total') || commandLower.includes('suma') || commandLower.includes('sum')) {
      // Calculate sum from current data if available
      if (currentData && Array.isArray(currentData)) {
        let sum = 0;
        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const val = currentData[r]?.[c];
            if (val && !isNaN(Number(val))) {
              sum += Number(val);
            }
          }
        }
        res.json({ cell: `Total: ${sum.toLocaleString('es-ES')}` });
      } else {
        res.json({ cell: 'Total: 0' });
      }
    }
    else if (commandLower.includes('promedio') || commandLower.includes('average') || commandLower.includes('media')) {
      if (currentData && Array.isArray(currentData)) {
        let sum = 0;
        let count = 0;
        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const val = currentData[r]?.[c];
            if (val && !isNaN(Number(val))) {
              sum += Number(val);
              count++;
            }
          }
        }
        const avg = count > 0 ? (sum / count).toFixed(2) : '0';
        res.json({ cell: `Promedio: ${avg}` });
      } else {
        res.json({ cell: 'Promedio: 0' });
      }
    }
    else if (commandLower.includes('tabla') || commandLower.includes('table') || commandLower.includes('reporte') || commandLower.includes('report')) {
      // Generate a sample data table
      const headers = ['ID', 'Nombre', 'Cantidad', 'Precio', 'Total'];
      const data: string[][] = [];
      
      // Add headers
      data.push(headers.slice(0, colCount));
      
      // Add data rows
      for (let i = 1; i < rowCount; i++) {
        const row: string[] = [];
        for (let j = 0; j < colCount; j++) {
          if (j === 0) row.push(String(i));
          else if (j === 1) row.push(['Producto A', 'Producto B', 'Producto C'][i % 3]);
          else if (j === 2) row.push(String(Math.floor(Math.random() * 100 + 1)));
          else if (j === 3) row.push(`€${(Math.random() * 100 + 10).toFixed(2)}`);
          else if (j === 4) row.push(`€${(Math.random() * 1000 + 100).toFixed(2)}`);
          else row.push('');
        }
        data.push(row);
      }
      
      res.json({ rangeData: data });
    }
    else if (commandLower.includes('inventario') || commandLower.includes('inventory')) {
      const headers = ['Código', 'Producto', 'Stock', 'Min', 'Precio'];
      const data: string[][] = [headers.slice(0, colCount)];
      
      for (let i = 1; i < rowCount; i++) {
        const row = [
          `SKU-${String(1000 + i).padStart(4, '0')}`,
          ['Widget A', 'Gadget B', 'Item C', 'Part D'][i % 4],
          String(Math.floor(Math.random() * 500)),
          String(Math.floor(Math.random() * 50 + 10)),
          `€${(Math.random() * 200 + 5).toFixed(2)}`
        ];
        data.push(row.slice(0, colCount));
      }
      
      res.json({ rangeData: data });
    }
    else {
      // Default: generate placeholder text
      res.json({ cell: `✨ ${command}` });
    }
  } catch (error) {
    console.error('AI Excel command error:', error);
    res.status(500).json({ error: 'Failed to process AI command' });
  }
});

// Stream endpoint for real-time AI generation
router.post('/excel-stream', async (req, res) => {
  try {
    const { prompt, context } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Simulate streaming response
    const response = `Generado con IA: ${prompt}`;
    
    for (const char of response) {
      res.write(char);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    res.end();
  } catch (error) {
    console.error('AI Excel stream error:', error);
    res.status(500).json({ error: 'Failed to stream AI response' });
  }
});

export default router;
