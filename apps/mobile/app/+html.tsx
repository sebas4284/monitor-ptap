import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

// SDK 58: preserve the generated styles, preload links and hydration scripts.
export default function RootHtml({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Aquora | Monitoreo de plantas de agua</title>
        <meta name="description" content="Aquora permite consultar el estado, las alertas y la operación de las plantas de tratamiento de agua. Accede con tu cuenta autorizada." />
        <meta name="theme-color" content="#171C28" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
